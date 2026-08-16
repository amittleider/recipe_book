import { useCallback, useEffect, useMemo, useRef, type PropsWithChildren } from 'react'
import { ActivityIndicator, Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native'
import { TrashIcon } from './TrashIcon'
import { colors } from '../theme'

/**
 * A list row that slides left to reveal a destructive action.
 *
 * Built on the core `Animated` and `PanResponder` APIs rather than
 * gesture-handler, which is a native module: adding one for a single gesture
 * would force every developer and tester onto a fresh development build.
 */

/** Width of the revealed action, and the resting offset of an open row. */
const ACTION_WIDTH = 88

/** Slack past the action so the drag has somewhere to go and feels elastic. */
const OVERSHOOT = 24

/** Travel before a pan reads as a swipe; below this the list keeps the gesture. */
const CLAIM_DISTANCE = 8

/** A flick this fast decides the row's resting state whatever the distance. */
const FLICK_VELOCITY = 0.3

type Props = PropsWithChildren<{
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
  busy?: boolean
  deleteLabel?: string
}>

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function SwipeableRow({
  open,
  onOpenChange,
  onDelete,
  busy = false,
  deleteLabel = 'Supprimer',
  children,
}: Props) {
  const translateX = useRef(new Animated.Value(0)).current
  // The gesture reads the resting position on every frame, so it cannot go
  // through React state without trailing the finger by a render.
  const openRef = useRef(open)

  const settle = useCallback(
    (next: boolean) => {
      openRef.current = next
      Animated.spring(translateX, {
        toValue: next ? -ACTION_WIDTH : 0,
        useNativeDriver: true,
        speed: 20,
        bounciness: 0,
      }).start()
    },
    [translateX],
  )

  // The list closes every row but the open one, so follow the prop whenever it
  // disagrees with where this row is resting.
  useEffect(() => {
    if (open !== openRef.current) settle(open)
  }, [open, settle])

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim only decidedly horizontal drags; everything else is a scroll.
        // A closed row ignores rightward drags too, since it has nowhere to go
        // and the list should keep the gesture.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > CLAIM_DISTANCE &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5 &&
          (openRef.current || gesture.dx < 0),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gesture) => {
          const resting = openRef.current ? -ACTION_WIDTH : 0
          translateX.setValue(clamp(resting + gesture.dx, -ACTION_WIDTH - OVERSHOOT, 0))
        },
        onPanResponderRelease: (_event, gesture) => {
          const resting = openRef.current ? -ACTION_WIDTH : 0
          const next =
            gesture.vx < -FLICK_VELOCITY
              ? true
              : gesture.vx > FLICK_VELOCITY
                ? false
                : resting + gesture.dx < -ACTION_WIDTH / 2
          settle(next)
          onOpenChange(next)
        },
        onPanResponderTerminate: () => settle(openRef.current),
      }),
    [onOpenChange, settle, translateX],
  )

  return (
    <View style={styles.row}>
      <View style={styles.actionLayer} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          onPress={onDelete}
          disabled={busy}
          style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : undefined]}
        >
          {busy ? <ActivityIndicator color={colors.dangerText} /> : <TrashIcon />}
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { borderRadius: 12, overflow: 'hidden' },
  // Widened by the overshoot so dragging past the action reveals more terra
  // cotta rather than the page behind it. Kept off the row itself so no colour
  // can bleed around the card's rounded corners while the row is closed.
  actionLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: ACTION_WIDTH + OVERSHOOT,
    alignItems: 'flex-end',
    backgroundColor: colors.danger,
  },
  action: { width: ACTION_WIDTH, height: '100%', alignItems: 'center', justifyContent: 'center' },
  actionPressed: { opacity: 0.75 },
} as const)
