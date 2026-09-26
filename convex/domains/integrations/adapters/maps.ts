import { notConnectedAdapter } from "./types"

// Geocoding and routes (Г-7: 2GIS, key pending). Until the adapter is written every job ends in dead-letter.
export const mapsAdapter = notConnectedAdapter("maps", "integration-maps", "карты и геокодирование (2GIS)")
