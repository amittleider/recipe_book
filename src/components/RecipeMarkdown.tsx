import { Fragment, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, fonts } from '../theme'

/** Bold and italic runs inside a single line, shared with the recipe view. */
export function inlineText(value: string): ReactNode[] {
  const parts = value.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text key={index} style={styles.bold}>{part.slice(2, -2)}</Text>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <Text key={index} style={styles.em}>{part.slice(1, -1)}</Text>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

export function RecipeMarkdown({ children }: { children: string }) {
  return (
    <View>
      {children.split(/\r?\n/).map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return <View key={index} style={styles.space} />
        if (/^---+$/.test(trimmed)) return <View key={index} style={styles.rule} />
        const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
        if (heading?.[1]) {
          const level = heading[1].length
          const style = level === 1 ? styles.heading1 : level === 2 ? styles.heading2 : styles.heading3
          return <Text key={index} style={style}>{inlineText(heading[2] ?? '')}</Text>
        }
        const bullet = trimmed.match(/^[-*]\s+(.+)$/)
        if (bullet?.[1]) {
          return <View key={index} style={styles.listRow}><Text style={styles.marker}>•</Text><Text style={styles.body}>{inlineText(bullet[1])}</Text></View>
        }
        const ordered = trimmed.match(/^(\d+)\.\s+(.+)$/)
        if (ordered?.[1] && ordered[2]) {
          return <View key={index} style={styles.listRow}><Text style={styles.marker}>{ordered[1]}.</Text><Text style={styles.body}>{inlineText(ordered[2])}</Text></View>
        }
        return <Text key={index} style={styles.body}>{inlineText(trimmed)}</Text>
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 24 },
  heading1: { color: colors.text, fontFamily: fonts.serif, fontSize: 30, lineHeight: 36, marginBottom: 4 },
  heading2: { color: colors.text, fontFamily: fonts.serif, fontSize: 22, lineHeight: 28, marginTop: 18, marginBottom: 4 },
  heading3: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, lineHeight: 24, marginTop: 14, marginBottom: 2 },
  bold: { fontWeight: '700' },
  em: { fontStyle: 'italic', color: colors.muted },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 6, marginVertical: 3 },
  marker: { width: 28, color: colors.text, fontSize: 16, lineHeight: 24 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 16 },
  space: { height: 8 },
} as const)
