import { describe, expect, it } from 'vitest'
import { groupsOf, isStreamAddress, parseM3u } from './m3u'

describe('parseM3u', () => {
  it('reads each channel’s name, logo and group', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="TRT1.tr" tvg-logo="https://i.example/trt1.png" group-title="General",TRT 1',
      'https://tv.example/trt1/index.m3u8',
      '#EXTINF:-1 group-title="News, TR",TRT Haber (720p)',
      '#EXTVLCOPT:http-user-agent=Mozilla',
      'https://tv.example/haber.m3u8',
    ].join('\n')
    expect(parseM3u(text)).toEqual([
      {
        name: 'TRT 1',
        url: 'https://tv.example/trt1/index.m3u8',
        logo: 'https://i.example/trt1.png',
        group: 'General',
      },
      { name: 'TRT Haber (720p)', url: 'https://tv.example/haber.m3u8', logo: null, group: 'News, TR' },
    ])
  })

  it('takes a BOM and Windows line ends', () => {
    const text = '﻿#EXTM3U\r\n#EXTINF:-1,One\r\nhttp://a.example/1.m3u8\r\n'
    expect(parseM3u(text)).toEqual([{ name: 'One', url: 'http://a.example/1.m3u8', logo: null, group: null }])
  })

  it('names a channel with no name, and a bare address, as it can', () => {
    expect(parseM3u('#EXTINF:-1 tvg-logo="x",\nhttps://a.example/s.m3u8', 'Live')[0]?.name).toBe('Live')
    expect(parseM3u('https://cdn.example/live.m3u8')[0]?.name).toBe('cdn.example')
  })

  it('skips what isn’t a web address', () => {
    expect(parseM3u('#EXTM3U\n#EXTINF:-1,Local\nC:\\video.ts\nrtmp://x/y')).toEqual([])
  })
})

describe('isStreamAddress', () => {
  it('tells a stream from a playlist of channels', () => {
    expect(isStreamAddress('https://a.example/live.m3u8?token=1')).toBe(true)
    expect(isStreamAddress('https://iptv-org.github.io/iptv/countries/tr.m3u')).toBe(false)
  })
})

describe('groupsOf', () => {
  it('lists each group once, in order', () => {
    const channel = (group: string | null) => ({ name: 'x', url: 'https://x', logo: null, group })
    expect(groupsOf([channel('News'), channel(null), channel('Sport'), channel('News')])).toEqual(['News', 'Sport'])
  })
})
