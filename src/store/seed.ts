import type { Station } from '@/types/station'

interface Seed {
  uuid: string
  name: string
  url: string
  codec: string
  bitrate: number
  country: string
  tags: string[]
  favicon?: string
}

/**
 * A first-run library. Every entry was verified to serve over https *and* send
 * an Access-Control-Allow-Origin header, so the equalizer and visualizer work
 * on all of them out of the box — the app should demonstrate its own headline
 * feature the first time it is opened.
 */
const SEEDS: Seed[] = [
  {
    uuid: '962cc6df-0601-11e8-ae97-52543be04c81',
    name: 'Dance Wave!',
    url: 'https://dancewave.online/dance.mp3',
    codec: 'MP3', bitrate: 128, country: 'Hungary',
    tags: ['dance', 'electronic', 'house', 'trance'],
    favicon: 'https://dancewave.online/dw_logo.png',
  },
  {
    uuid: 'c4077677-dc2f-11e9-a8ba-52543be04c81',
    name: 'Heart 80s',
    url: 'https://media-ssl.musicradio.com/Heart80sMP3',
    codec: 'MP3', bitrate: 128, country: 'United Kingdom',
    tags: ['80s', 'pop', 'variety'],
  },
  {
    uuid: '4ad5bdc7-01e5-47c9-a1f9-751671b4707e',
    name: 'Capital FM',
    url: 'https://media-ssl.musicradio.com/CapitalUK',
    codec: 'AAC', bitrate: 48, country: 'United Kingdom',
    tags: ['pop', 'top hits'],
  },
  {
    uuid: '6eff3484-4ab4-4d36-bf27-9172c5aac15c',
    name: 'WALM Vinyl HD',
    url: 'https://icecast.walmradio.com:8443/christmas',
    codec: 'MP3', bitrate: 320, country: 'United States',
    tags: ['vintage', 'vinyl', 'easy listening'],
  },
  {
    uuid: 'd39ab442-6c34-4097-afd0-e298ac21e50c',
    name: 'Nostalgie HQ',
    url: 'https://streaming.nrjaudio.fm/oua8a3w2dqao?origine=playernostalgie',
    codec: 'AAC', bitrate: 320, country: 'France',
    tags: ['oldies', 'classics'],
  },
  {
    uuid: '36eba167-5c51-4421-98f0-d2cda24be928',
    name: 'NRJ Hits',
    url: 'https://streaming.nrjaudio.fm/ou7xugf3s5gi?origine=playernrj',
    codec: 'AAC+', bitrate: 128, country: 'France',
    tags: ['hits', 'pop'],
  },
  {
    uuid: '33178054-56cd-449c-8cf7-412cc7be936a',
    name: 'CNN',
    url: 'https://tunein.cdnstream1.com/2868_96.mp3',
    codec: 'MP3', bitrate: 96, country: 'United States',
    tags: ['news', 'talk'],
  },
  {
    uuid: 'cdd3b5a0-47f6-46d5-8209-b78e8b10ff6e',
    name: 'Radio Mirchi Hindi',
    url: 'https://eu8.fastcast4u.com/proxy/clyedupq/stream',
    codec: 'MP3', bitrate: 128, country: 'India',
    tags: ['bollywood', 'hindi'],
  },
  {
    uuid: 'f3dfbec0-8ddb-457c-94cd-368631337c0f',
    name: 'Damar Türk FM',
    url: 'https://live.radyositesihazir.com:10997/',
    codec: 'MP3', bitrate: 128, country: 'Türkiye',
    tags: ['turkish', 'folk'],
  },
  {
    uuid: 'be3d699a-dbd5-4057-a049-f86fa705e0e6',
    name: 'Aardvark Blues FM',
    // The directory lists this as http://; the same host serves it over https
    // with CORS, so we store the https form and keep the full audio pipeline.
    url: 'https://edge4.peta.live365.net/b77280_128mp3',
    codec: 'MP3', bitrate: 128, country: 'United States',
    tags: ['blues'],
  },
  {
    uuid: 'c76686ca-a8b9-4db9-9839-1470c9599623',
    name: '102.7 KIIS FM',
    url: 'https://stream.revma.ihrhls.com/zc185',
    codec: 'AAC', bitrate: 0, country: 'United States',
    tags: ['pop', 'top 40'],
  },
]

export function seedStations(): Station[] {
  const now = Date.now()
  return SEEDS.map((s, i) => ({
    id: `rb:${s.uuid}`,
    sourceUuid: s.uuid,
    name: s.name,
    url: s.url,
    favicon: s.favicon,
    codec: s.codec,
    bitrate: s.bitrate || undefined,
    country: s.country,
    tags: s.tags,
    isHls: false,
    favorite: i < 3,
    addedAt: now + i,
    playCount: 0,
    capability: 'unknown',
  }))
}
