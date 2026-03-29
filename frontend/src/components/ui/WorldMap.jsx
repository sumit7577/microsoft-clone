import { memo } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from 'react-simple-maps';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

function WorldMap({ markers = [] }) {
  return (
    <div style={{ width: '100%', aspectRatio: '2/1', overflow: 'hidden' }}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 130, center: [0, 30] }}
        width={800}
        height={400}
        style={{ width: '100%', height: '100%' }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#ffffff"
                stroke="#0a0c10"
                strokeWidth={0.5}
                style={{
                  default: { outline: 'none' },
                  hover: { fill: '#e0e0e0', outline: 'none' },
                  pressed: { outline: 'none' },
                }}
              />
            ))
          }
        </Geographies>

        {markers.map((m, i) => (
          <Marker key={i} coordinates={[m.lng, m.lat]}>
            <circle r={Math.min(3 + (m.count || 1), 10)} fill="#d13438" fillOpacity={0.6} stroke="#d13438" strokeWidth={1} strokeOpacity={0.3} />
            <circle r={2} fill="#d13438" />
          </Marker>
        ))}
      </ComposableMap>
    </div>
  );
}

export default memo(WorldMap);
