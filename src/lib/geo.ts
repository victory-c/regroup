/**
 * Turns an `openweathermap/geocoding` candidate into the city query string the
 * `openweathermap/forecast` endpoint accepts. The forecast endpoint takes
 * `q` only (no lat/lon), and OpenWeatherMap only honours a state code for US
 * cities — so "Berkeley,CA,US" disambiguates, but "Berkeley,CA" alone resolves
 * to Canada. Geocoding first and building the query from the chosen candidate
 * avoids that trap.
 */

export interface GeoCandidate {
  name: string
  lat: number
  lon: number
  country: string
  state?: string
}

const US_STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
}

export function weatherQueryFor(c: GeoCandidate): string {
  if (c.country === 'US' && c.state && US_STATES[c.state]) {
    return `${c.name},${US_STATES[c.state]},US`
  }
  return `${c.name},${c.country}`
}

export function labelFor(c: GeoCandidate): string {
  return [c.name, c.state, c.country].filter(Boolean).join(', ')
}
