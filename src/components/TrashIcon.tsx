import { View } from 'react-native'
import { colors } from '../theme'

/**
 * A trash glyph drawn from plain views.
 *
 * The app ships no icon font or SVG renderer, and both would be native
 * dependencies requiring a fresh development build for one small mark. Views
 * cost nothing, scale cleanly, and stay crisp at any density.
 */
export function TrashIcon({ size = 22, color = colors.dangerText }: { size?: number; color?: string }) {
  // Every measurement below is expressed against a 22pt reference drawing.
  const unit = size / 22
  const stroke = Math.max(1.4, 2 * unit)

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 8 * unit,
          height: stroke,
          backgroundColor: color,
          borderTopLeftRadius: stroke,
          borderTopRightRadius: stroke,
        }}
      />
      <View
        style={{
          width: 18 * unit,
          height: stroke,
          marginTop: unit,
          borderRadius: stroke,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: 14 * unit,
          height: 12 * unit,
          marginTop: 1.5 * unit,
          borderColor: color,
          borderWidth: stroke,
          borderTopWidth: 0,
          borderBottomLeftRadius: 3 * unit,
          borderBottomRightRadius: 3 * unit,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3 * unit,
        }}
      >
        <View style={{ width: stroke * 0.75, height: 6 * unit, borderRadius: stroke, backgroundColor: color }} />
        <View style={{ width: stroke * 0.75, height: 6 * unit, borderRadius: stroke, backgroundColor: color }} />
      </View>
    </View>
  )
}
