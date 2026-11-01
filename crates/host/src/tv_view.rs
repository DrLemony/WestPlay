//! TV's player: a WebView of its own (its own browser and profile), placed over the cabin page where TV's
//! screen is, playing what TV asks (`tv-player.html`, ui/src/tvPlayer).
//!
//! Its page is plain `http://` and its browser runs without web security, both on purpose: an Xtream server
//! and many M3U channels are `http://` and send no CORS headers, which the cabin page (secure, `https://`)
//! can't load. Only WestPlay's own page runs here; the rest it loads is video and text (playlists, Xtream's
//! JSON), fetched for the cabin page (`Command::Fetch`), and what it says back crosses as data.
//!
//! The PC videos (the folder chosen in the companion, `settings::TvSettings`) are served to it at
//! `http://westplay.videos/`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::webview::{Error, OffscreenWebView, Stage};

/// The player's own page's host, and the PC videos'.
const PAGE_HOST: &str = "westplay.tv";
const VIDEOS_HOST: &str = "westplay.videos";
/// Its browser: no CORS and no mixed-content blocking (the module's note).
const ARGUMENTS: &str = "--disable-web-security --allow-running-insecure-content";
/// The videos a folder lists, at most, and how deep in it they're looked for.
const MAX_VIDEOS: usize = 2000;
const MAX_DEPTH: usize = 3;
const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "m4v", "webm", "mov", "mkv", "ogv"];

/// What the cabin page asks of TV (`TvCommand` in ui/src/shared/host.ts).
#[derive(Debug, PartialEq, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Command {
    /// Where TV's screen is on the page (its pixels), the player shown there.
    Show {
        x: f32,
        y: f32,
        width: u32,
        height: u32,
    },
    Hide,
    /// The player gone (its browser too).
    Close,
    Play {
        url: String,
    },
    Pause,
    Resume,
    Stop,
    Volume {
        share: f32,
    },
    /// A playlist or Xtream's answer, fetched by the player's page: answered with `tvFetched` and the same id.
    Fetch {
        id: u32,
        url: String,
    },
    /// The PC videos: answered with `tvVideos`.
    Videos,
    /// The PC clipboard's text, for a link field's paste button: answered with `tvPasted`.
    Paste,
}

/// A PC video: its name and where the player loads it.
#[derive(Debug, PartialEq, Serialize)]
pub struct Video {
    pub name: String,
    pub url: String,
}

pub struct Tv {
    pub view: OffscreenWebView,
    area: Option<(f32, f32, u32, u32)>,
}

impl Tv {
    /// The player, its page `page` (the cabin's own UI folder's `tv-player.html`, or the dev server's).
    pub fn new(stage: &Stage, profile: &Path, page: &TvPage) -> Result<Self, Error> {
        let view = OffscreenWebView::with_arguments(stage, 800, 600, profile, ARGUMENTS)?;
        match page {
            TvPage::Folder(root) => {
                view.map_folder(PAGE_HOST, root)?;
                view.navigate(&format!("http://{PAGE_HOST}/tv-player.html"))?;
            }
            TvPage::Url(url) => view.navigate(url)?,
        }
        stage.add(&view, true)?;
        view.show(false)?;
        Ok(Self { view, area: None })
    }

    pub fn command(&mut self, command: Command, stage: &Stage, videos: Option<&str>) -> Result<Option<String>, Error> {
        match command {
            Command::Show { x, y, width, height } => {
                let (page_width, page_height) = stage.page_size().get();
                let fits = x.is_finite()
                    && y.is_finite()
                    && x >= 0.0
                    && y >= 0.0
                    && width > 0
                    && height > 0
                    && x + width as f32 <= page_width as f32 + 1.0
                    && y + height as f32 <= page_height as f32 + 1.0;
                if fits && self.area != Some((x, y, width, height)) {
                    self.view.place(x, y, width, height)?;
                    self.view.show(true)?;
                    self.area = Some((x, y, width, height));
                }
            }
            Command::Hide | Command::Close => {
                self.area = None;
                self.view.show(false)?;
                self.post(&serde_json::json!({ "action": "stop" }))?;
            }
            Command::Play { url } if web_address(&url) => {
                self.post(&serde_json::json!({ "action": "play", "url": url }))?
            }
            Command::Play { .. } => {}
            Command::Pause => self.post(&serde_json::json!({ "action": "pause" }))?,
            Command::Resume => self.post(&serde_json::json!({ "action": "resume" }))?,
            Command::Stop => self.post(&serde_json::json!({ "action": "stop" }))?,
            Command::Volume { share } if share.is_finite() => {
                self.post(&serde_json::json!({ "action": "volume", "share": share.clamp(0.0, 1.0) }))?;
            }
            Command::Volume { .. } => {}
            Command::Fetch { id, url } if web_address(&url) => {
                self.post(&serde_json::json!({ "action": "fetch", "id": id, "url": url }))?;
            }
            Command::Fetch { id, .. } => {
                return Ok(Some(serde_json::json!({ "type": "tvFetched", "id": id, "ok": false }).to_string()));
            }
            Command::Videos => {
                let folder = videos.map(Path::new).filter(|folder| folder.is_dir());
                if let Some(folder) = folder {
                    self.view.map_folder_to_any_page(VIDEOS_HOST, folder)?;
                }
                let list = folder.map(list_videos).unwrap_or_default();
                let message = serde_json::json!({ "type": "tvVideos", "folder": folder.is_some(), "videos": list });
                return Ok(Some(message.to_string()));
            }
            Command::Paste => {
                let text =
                    crate::typing::clipboard_text().map(|text| crate::typing::one_line(&text)).unwrap_or_default();
                return Ok(Some(serde_json::json!({ "type": "tvPasted", "text": text }).to_string()));
            }
        }
        Ok(None)
    }

    fn post(&self, message: &serde_json::Value) -> windows::core::Result<()> {
        self.view.post_json(&message.to_string())
    }

    /// What the player's page said since last asked, for the cabin page: its playing (`tvState`) and what it
    /// fetched (`tvFetched`). Anything else it posts is dropped.
    pub fn take_messages(&self) -> Vec<String> {
        self.view.take_page_messages().into_iter().filter_map(|message| relayed(&message)).collect()
    }
}

/// Where TV's player page comes from: the cabin's UI folder, or (developing) the dev server's address.
pub enum TvPage {
    Folder(std::path::PathBuf),
    Url(String),
}

/// An `http`/`https` address: all the player loads.
fn web_address(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
}

/// The player page's message, checked and passed on to the cabin page: its state (three flags) or a fetch's
/// answer (an id, whether it worked, and the text).
fn relayed(message: &str) -> Option<String> {
    #[derive(Deserialize)]
    #[serde(tag = "type", rename_all = "camelCase")]
    enum FromPlayer {
        State {
            playing: bool,
            loading: bool,
            failed: bool,
        },
        Fetched {
            id: u32,
            ok: bool,
            #[serde(default)]
            text: String,
        },
    }
    Some(
        match serde_json::from_str(message).ok()? {
            FromPlayer::State { playing, loading, failed } => {
                serde_json::json!({ "type": "tvState", "playing": playing, "loading": loading, "failed": failed })
            }
            FromPlayer::Fetched { id, ok, text } => {
                serde_json::json!({ "type": "tvFetched", "id": id, "ok": ok, "text": text })
            }
        }
        .to_string(),
    )
}

/// The videos in `folder` and its folders (a few deep), by name, each with its address at `westplay.videos`.
pub fn list_videos(folder: &Path) -> Vec<Video> {
    let mut videos = Vec::new();
    walk(folder, Path::new(""), 0, &mut videos);
    videos.sort_by_key(|video| video.name.to_lowercase());
    videos
}

fn walk(folder: &Path, relative: &Path, depth: usize, videos: &mut Vec<Video>) {
    let Ok(entries) = std::fs::read_dir(folder.join(relative)) else { return };
    for entry in entries.flatten() {
        if videos.len() >= MAX_VIDEOS {
            return;
        }
        let path = relative.join(entry.file_name());
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() && depth < MAX_DEPTH {
            walk(folder, &path, depth + 1, videos);
        } else if kind.is_file() && is_video(&path) {
            let name = path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
            let parts: Vec<String> = path
                .iter()
                .map(|part| url::form_urlencoded::byte_serialize(part.to_string_lossy().as_bytes()).collect::<String>())
                .map(|part| part.replace('+', "%20"))
                .collect();
            videos.push(Video { name, url: format!("http://{VIDEOS_HOST}/{}", parts.join("/")) });
        }
    }
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| VIDEO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plays_web_addresses_only() {
        assert!(web_address("http://xtream.example:8080/live/a/b/1.m3u8"));
        assert!(web_address("https://iptv-org.github.io/iptv/countries/tr.m3u"));
        assert!(!web_address("file:///C:/Windows/win.ini"));
        assert!(!web_address("javascript:alert(1)"));
    }

    #[test]
    fn passes_on_the_players_state_and_answers_only() {
        assert_eq!(
            relayed(r#"{"type":"state","playing":true,"loading":false,"failed":false}"#).as_deref(),
            Some(r#"{"failed":false,"loading":false,"playing":true,"type":"tvState"}"#)
        );
        assert_eq!(
            relayed(r##"{"type":"fetched","id":3,"ok":true,"text":"#EXTM3U"}"##).as_deref(),
            Some(r##"{"id":3,"ok":true,"text":"#EXTM3U","type":"tvFetched"}"##)
        );
        assert_eq!(relayed(r#"{"type":"navigate","url":"x"}"#), None);
        assert_eq!(relayed("not json"), None);
    }

    #[test]
    fn lists_the_folders_videos_with_their_addresses() {
        let folder = std::env::temp_dir().join(format!("westplay-tv-videos-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(folder.join("Dizi 1")).unwrap();
        std::fs::write(folder.join("b film.MP4"), b"").unwrap();
        std::fs::write(folder.join("Dizi 1").join("a bölüm.webm"), b"").unwrap();
        std::fs::write(folder.join("notes.txt"), b"").unwrap();
        let videos = list_videos(&folder);
        let _ = std::fs::remove_dir_all(&folder);
        assert_eq!(
            videos,
            [
                Video {
                    name: "a bölüm".into(),
                    url: "http://westplay.videos/Dizi%201/a%20b%C3%B6l%C3%BCm.webm".into()
                },
                Video { name: "b film".into(), url: "http://westplay.videos/b%20film.MP4".into() },
            ]
        );
    }

    /// The real player: its page (the built UI, `WESTPLAY_UI`) fetches from a plain `http://` server that sends
    /// no CORS header, as an Xtream server does, and plays a live stream (TRT 1's, so it needs the internet).
    #[test]
    #[ignore = "starts WebView2, needs WESTPLAY_UI and the internet"]
    fn fetches_without_cors_and_plays_a_stream() {
        use std::io::{Read, Write};
        use std::time::{Duration, Instant};
        use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
        // SAFETY: COM is initialized on this test's own thread before creating the view.
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        }
        let ui = std::env::var("WESTPLAY_UI").expect("WESTPLAY_UI");
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut stream in server.incoming().flatten() {
                let mut request = [0; 4096];
                let _ = stream.read(&mut request);
                let body = r#"[{"category_id":"1","category_name":"Haber"}]"#;
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: {}
Connection: close

{body}",
                    body.len()
                );
            }
        });
        let pump = |ms| {
            let end = Instant::now() + Duration::from_millis(ms);
            while Instant::now() < end {
                crate::pump_messages();
                std::thread::sleep(Duration::from_millis(10));
            }
        };
        let profile = std::env::temp_dir().join(format!("westplay-tv-test-{}", std::process::id()));
        let stage = Stage::new(800, 600).unwrap();
        let mut tv = Tv::new(&stage, &profile, &TvPage::Folder(ui.into())).unwrap();
        pump(2500);
        tv.command(Command::Show { x: 0.0, y: 0.0, width: 800, height: 450 }, &stage, None).unwrap();
        let url = format!("http://127.0.0.1:{port}/player_api.php?action=get_live_categories");
        tv.command(Command::Fetch { id: 7, url }, &stage, None).unwrap();
        let mut said = Vec::new();
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until && !said.iter().any(|m: &String| m.contains("tvFetched")) {
            pump(100);
            said.extend(tv.take_messages());
        }
        let fetched = said.iter().find(|m| m.contains("tvFetched")).expect("an answer to the fetch");
        assert!(fetched.contains(r#""ok":true"#) && fetched.contains("Haber"), "{fetched}");

        let stream = "https://tv-trt1.medya.trt.com.tr/master.m3u8".to_string();
        tv.command(Command::Play { url: stream }, &stage, None).unwrap();
        let until = Instant::now() + Duration::from_secs(20);
        let mut playing = false;
        while Instant::now() < until && !playing {
            pump(200);
            playing = tv.take_messages().iter().any(|m| m.contains(r#""playing":true"#));
        }
        assert!(playing, "the stream didn't play");
        pump(3000);
        let video = tv
            .view
            .evaluate("(v => [v.currentTime, v.videoWidth, v.videoHeight])(document.querySelector('video'))")
            .unwrap();
        println!("video: {video}");
        let [time, width, _]: [f64; 3] = serde_json::from_str(&video).unwrap();
        assert!(time > 1.0 && width > 0.0, "the picture didn't move: {video}");
        let _ = std::fs::remove_dir_all(&profile);
    }
}
