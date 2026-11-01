import { describe, expect, it } from 'vitest'
import { apiAddress, liveChannels, serverAddress, signedIn } from './xtream'

const login = { server: 'tv.example.com:8080', username: 'ali veli', password: 'p&ss' }

describe('serverAddress', () => {
  it('makes what was typed an address', () => {
    expect(serverAddress(' tv.example.com:8080/ ')).toBe('http://tv.example.com:8080')
    expect(serverAddress('https://tv.example.com/player_api.php?username=a')).toBe('https://tv.example.com')
  })
})

describe('apiAddress', () => {
  it('signs in with the login, escaped', () => {
    expect(apiAddress(login, 'get_live_categories')).toBe(
      'http://tv.example.com:8080/player_api.php?username=ali+veli&password=p%26ss&action=get_live_categories',
    )
  })
})

describe('signedIn', () => {
  it('reads the first answer’s auth', () => {
    expect(signedIn('{"user_info":{"auth":1,"status":"Active"}}')).toBe(true)
    expect(signedIn('{"user_info":{"auth":0}}')).toBe(false)
    expect(signedIn('<html>')).toBe(false)
  })
})

describe('liveChannels', () => {
  it('lists the streams in their categories, each at its address', () => {
    const categories = '[{"category_id":"3","category_name":"Spor"}]'
    const streams = JSON.stringify([
      { stream_id: 42, name: ' TRT Spor ', stream_icon: 'http://i/x.png', category_id: '3' },
      { stream_id: '7', name: 'Haber', stream_icon: '', category_id: '9' },
      { name: 'no id' },
    ])
    expect(liveChannels(login, categories, streams)).toEqual([
      {
        name: 'TRT Spor',
        url: 'http://tv.example.com:8080/live/ali%20veli/p%26ss/42.m3u8',
        logo: 'http://i/x.png',
        group: 'Spor',
      },
      { name: 'Haber', url: 'http://tv.example.com:8080/live/ali%20veli/p%26ss/7.m3u8', logo: null, group: null },
    ])
  })

  it('lists nothing from an answer that isn’t a list', () => {
    expect(liveChannels(login, 'x', '{"error":"bad"}')).toEqual([])
  })
})
