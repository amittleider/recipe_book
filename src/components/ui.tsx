import type { PropsWithChildren, ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from 'react-native'
import { colors, fonts } from '../theme'

export function Screen({ children, scroll = false }: PropsWithChildren<{ scroll?: boolean }>) {
  return (
    <SafeAreaView style={styles.screen}>
      {scroll ? <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView> : children}
    </SafeAreaView>
  )
}

export function Header({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>{left}</View>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={[styles.headerSide, styles.headerRight]}>{right}</View>
    </View>
  )
}

export function Button({ children, variant = 'primary', busy, style, ...props }: PropsWithChildren<PressableProps & { variant?: 'primary' | 'secondary' | 'link'; busy?: boolean }>) {
  return (
    <Pressable
      accessibilityRole="button"
      style={(state) => [
        styles.button,
        variant === 'secondary' ? styles.secondaryButton : undefined,
        variant === 'link' ? styles.linkButton : undefined,
        state.pressed ? styles.pressed : undefined,
        props.disabled ? styles.disabled : undefined,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? colors.background : colors.text} />
      ) : (
        <Text style={[
          styles.buttonText,
          variant !== 'primary' ? styles.secondaryButtonText : undefined,
          variant === 'link' ? styles.linkButtonText : undefined,
        ]}>{children}</Text>
      )}
    </Pressable>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null
  return <Text style={styles.error}>{message}</Text>
}

export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  return (
    <View style={styles.state}>
      <ActivityIndicator />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  )
}

export const layout = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  grow: { flex: 1 },
})

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 20 },
  header: {
    minHeight: 58,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSide: { width: 96, alignItems: 'flex-start' },
  headerRight: { alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.serif, fontSize: 21, color: colors.text },
  button: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.text,
    borderWidth: 1,
    borderColor: colors.text,
  },
  secondaryButton: { backgroundColor: colors.surface, borderColor: colors.border },
  linkButton: { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 8 },
  buttonText: { color: colors.background, fontSize: 15, fontWeight: '600' },
  secondaryButtonText: { color: colors.text },
  linkButtonText: { color: colors.text, textDecorationLine: 'underline', fontWeight: '400' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  error: {
    color: colors.error,
    backgroundColor: colors.errorBackground,
    borderColor: '#F1CFCA',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  state: { flex: 1, minHeight: 180, justifyContent: 'center', alignItems: 'center', gap: 12 },
  stateText: { color: colors.muted },
} as const)
