import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputInstance,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import type { Tokens } from "@/constants/design";
import { useT } from "@/lib/theme";
import { MAX_SHEET_WIDTH, useResponsive } from "@/hooks/useResponsive";
import type { ChipDef, Tone } from "@/lib/format";
import { FONT, TYPE, fontFor, trackingFor, useFontsReady } from "@/lib/fonts";
import Icon, { type IconName } from "./Icon";
import { FadeInUp, useEntrance, usePressScale, useReducedMotion } from "./motion";

/* ───────────── Text ───────────── */

export function Txt({ style, ...p }: TextProps & { style?: TextStyle | TextStyle[] }) {
  const T = useT();
  const fonts = useFontsReady();
  const flat = StyleSheet.flatten([{ color: T.fg, fontSize: T.rowFs }, style]) as TextStyle;
  if (!fonts) return <Text {...p} style={flat} />;
  // Each Inter file is one weight: pick the file for the weight and keep the weight "normal", so
  // Android never synthesises bold on top of it. Larger text gets Inter's tighter display tracking.
  return (
    <Text
      {...p}
      style={{
        ...flat,
        fontFamily: flat.fontFamily ?? fontFor(flat.fontWeight),
        fontWeight: "normal",
        letterSpacing: flat.letterSpacing ?? trackingFor(flat.fontSize ?? T.rowFs),
      }}
    />
  );
}

/** Inter for text inputs, once it has loaded. */
function useInputFont(weight: "regular" | "semibold" = "regular"): TextStyle {
  const fonts = useFontsReady();
  return fonts ? { fontFamily: FONT[weight], fontWeight: "normal" } : {};
}

/* ───────────── Section scaffolding ───────────── */

function SecHead({ h, px }: { h?: string; px?: number }) {
  const T = useT();
  if (!h) return null;
  return (
    <Txt
      accessibilityRole="header"
      style={{
        fontSize: T.shFs,
        color: T.shFg,
        // Inter's medium reads clearly at heading sizes; uppercase headings get open tracking.
        fontWeight: T.shUpper ? T.shFw : "600",
        letterSpacing: T.shUpper ? 0.6 : 0.1,
        textTransform: T.shUpper ? "uppercase" : "none",
        paddingHorizontal: px ?? T.shPx,
        paddingBottom: T.ios ? 6 : 6,
      }}
    >
      {h}
    </Txt>
  );
}
function SecFoot({ f, px }: { f?: string; px?: number }) {
  const T = useT();
  if (!f) return null;
  return (
    <Txt
      style={{
        ...TYPE.footnote,
        color: T.fg2,
        paddingHorizontal: px ?? T.shPx,
        paddingTop: 7,
        lineHeight: 18,
      }}
    >
      {f}
    </Txt>
  );
}

export function Section({
  h,
  f,
  children,
  style,
  px,
}: {
  h?: string;
  f?: string;
  children?: React.ReactNode;
  style?: ViewStyle;
  /** Inset of the heading and footnote; defaults to the list inset. */
  px?: number;
}) {
  const T = useT();
  return (
    <View style={[{ marginBottom: T.secGap }, style]}>
      <SecHead h={h} px={px} />
      {children}
      <SecFoot f={f} px={px} />
    </View>
  );
}

/** Grouped list. iOS: inset white card with hairlines. Material: tonal rows with 2dp gaps. */
export function List({
  h,
  f,
  empty,
  children,
}: {
  h?: string;
  f?: string;
  empty?: string;
  children?: React.ReactNode;
}) {
  const T = useT();
  const kids = React.Children.toArray(children).filter(Boolean);
  if (!kids.length && !empty && !h) return null;
  return (
    <Section h={h} f={f}>
      {kids.length ? (
        <View
          style={{
            marginHorizontal: 16,
            borderRadius: T.listR,
            overflow: "hidden",
            gap: T.listGap,
            backgroundColor: T.rowBg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: T.cardBd,
          }}
        >
          {kids.map((k, i) => (
            <FadeInUp key={i} index={i}>
              {k}
              {i < kids.length - 1 ? (
                <View
                  style={{
                    height: StyleSheet.hairlineWidth,
                    backgroundColor: T.sep,
                    // Rows with a leading icon start their divider at the text, as native lists do.
                    marginLeft:
                      React.isValidElement<{ ic?: unknown }>(k) && k.props.ic ? 28 + T.icBox : 16,
                  }}
                />
              ) : null}
            </FadeInUp>
          ))}
        </View>
      ) : empty ? (
        <View
          style={{
            marginHorizontal: 16,
            padding: 20,
            borderRadius: T.listR,
            backgroundColor: T.rowBg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: T.cardBd,
          }}
        >
          <Txt style={{ color: T.fg2, ...TYPE.subhead, textAlign: "center" }}>{empty}</Txt>
        </View>
      ) : null}
    </Section>
  );
}

export function Chip({ c }: { c?: ChipDef | null }) {
  const T = useT();
  if (!c) return null;
  const tn = T.tones[c.tone];
  return (
    <View
      style={{
        backgroundColor: tn.bg,
        borderRadius: T.chipR,
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignSelf: "flex-start",
      }}
    >
      <Txt style={{ color: tn.fg, ...TYPE.caption, fontWeight: "600" }} numberOfLines={1}>
        {c.label}
      </Txt>
    </View>
  );
}

export interface RowProps {
  t: string;
  s?: string;
  v?: string;
  vfg?: string;
  chip?: ChipDef | null;
  ic?: IconName;
  icBg?: string;
  icFg?: string;
  dot?: boolean;
  chev?: boolean;
  fg?: string;
  fw?: TextStyle["fontWeight"];
  /** Signature SVG path to show instead of a value. */
  sig?: string;
  onPress?: () => void;
}

export function Row({
  t,
  s,
  v,
  vfg,
  chip,
  ic,
  icBg,
  icFg,
  dot,
  chev,
  fg,
  fw,
  sig,
  onPress,
}: RowProps) {
  const T = useT();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => ({
        backgroundColor: pressed && onPress ? T.rowPress : T.rowBg,
        minHeight: T.rowMin,
        paddingVertical: T.rowPy,
        paddingLeft: 16,
        paddingRight: chev ? 10 : 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      })}
    >
      {dot ? (
        <View
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.dot, marginLeft: -4 }}
        />
      ) : null}
      {ic ? (
        <View
          style={{
            width: T.icBox,
            height: T.icBox,
            borderRadius: T.icR,
            backgroundColor: icBg ?? T.icBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={ic} size={T.ios ? 18 : 20} color={icFg ?? T.icFg} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ color: fg ?? T.fg, fontWeight: fw ?? "400" }}>{t}</Txt>
        {s ? (
          <Txt style={{ color: T.fg2, fontSize: T.ios ? 15 : 14, lineHeight: 20 }}>{s}</Txt>
        ) : null}
        {chip ? (
          <View style={{ marginTop: 4 }}>
            <Chip c={chip} />
          </View>
        ) : null}
      </View>
      {sig ? <SigPreview d={sig} /> : null}
      {v ? (
        <Txt style={{ color: vfg ?? T.fg2, maxWidth: "55%", flexShrink: 1, textAlign: "right" }}>
          {v}
        </Txt>
      ) : null}
      {chev ? <Icon name="chevR" size={20} color={T.fg3} /> : null}
    </Pressable>
  );
}

/* ───────────── Hero card ───────────── */

export interface Stat {
  label: string;
  value: string;
  fg?: string;
  note?: string;
  /**
   * How full the stock is, 0–1, with a tick where "running low" starts, so a glance at the bar
   * says how close a hotspot is to needing a delivery.
   */
  meter?: { fill: number; mark: number; color: string };
}
export interface StepItem {
  label: string;
  st: "done" | "cur" | "warn" | "todo" | "skip";
  sub?: string;
}

export function Hero({
  h,
  title,
  sub,
  chip,
  stats,
  steps,
  msg,
  children,
}: {
  h?: string;
  title: string;
  sub?: string;
  chip?: ChipDef | null;
  stats?: Stat[];
  steps?: StepItem[];
  msg?: string;
  children?: React.ReactNode;
}) {
  const T = useT();
  return (
    <Section h={h}>
      <View
        style={{
          marginHorizontal: 16,
          backgroundColor: T.cardBg,
          borderRadius: T.cardR,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: T.cardBd,
          padding: 16,
          gap: 12,
        }}
      >
        <View style={{ gap: 4 }}>
          <Txt style={{ fontSize: 20, lineHeight: 26, fontWeight: T.ios ? "700" : "600" }}>
            {title}
          </Txt>
          {sub ? <Txt style={{ color: T.fg2, ...TYPE.subhead }}>{sub}</Txt> : null}
          {chip ? (
            <View style={{ marginTop: 4 }}>
              <Chip c={chip} />
            </View>
          ) : null}
        </View>
        {stats?.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {stats.map((x) => (
              <View
                key={x.label}
                style={{
                  // Tiles share a row while each gets 112dp; below that they wrap.
                  flexGrow: 1,
                  flexBasis: 112,
                  minWidth: 0,
                  backgroundColor: T.tileBg,
                  borderRadius: T.tileR,
                  padding: 12,
                  gap: 2,
                }}
              >
                <Txt style={{ ...TYPE.footnote, color: T.fg2 }}>{x.label}</Txt>
                <CountUp
                  value={x.value}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={{
                    fontSize: 26,
                    fontWeight: "700",
                    color: x.fg ?? T.fg,
                    fontVariant: ["tabular-nums"],
                  }}
                />
                {x.meter ? <Meter {...x.meter} label={`${x.label}: ${x.note ?? x.value}`} /> : null}
                {x.note ? (
                  <Txt style={{ ...TYPE.footnote, color: x.fg ?? T.fg2 }}>{x.note}</Txt>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        {steps?.length ? <Steps items={steps} /> : null}
        {msg ? <Txt style={{ color: T.fg2, ...TYPE.subhead }}>{msg}</Txt> : null}
        {children ? <View style={{ gap: 8 }}>{children}</View> : null}
      </View>
    </Section>
  );
}

const withCommas = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * A number that counts up from zero to its value when it first appears ("1,400"). Anything that
 * is not a plain number ("out of stock") is shown as it is.
 */
export function CountUp({
  value,
  style,
  ...rest
}: { value: string; style?: TextStyle } & Omit<
  React.ComponentProps<typeof Txt>,
  "style" | "children"
>) {
  const reduce = useReducedMotion();
  const target = /^\d[\d,]*$/.test(value) ? Number(value.replace(/,/g, "")) : null;
  const [shown, setShown] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    // Count only on first appearance; later changes (a sync) show the new value straight away.
    if (target == null || reduce || !first.current || target === 0) {
      setShown(value);
      first.current = false;
      return;
    }
    first.current = false;
    const v = new Animated.Value(0);
    const id = v.addListener(({ value: x }) => setShown(withCommas(x)));
    Animated.timing(v, {
      toValue: target,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => setShown(value));
    return () => {
      v.removeListener(id);
      v.stopAnimation();
    };
  }, [value, target, reduce]);
  return (
    <Txt style={style} accessibilityLabel={value} {...rest}>
      {shown}
    </Txt>
  );
}

/** 0 → 1 on a spring when the component appears, for a result badge. */
function useSpringIn(): Animated.Value {
  const reduce = useReducedMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return v.setValue(1);
    Animated.spring(v, { toValue: 1, damping: 11, stiffness: 180, useNativeDriver: true }).start();
  }, [v, reduce]);
  return v;
}

/** A stock level bar: filled to `fill`, with a tick at `mark` (both 0–1). */
export function Meter({
  fill,
  mark,
  color,
  label,
}: {
  fill: number;
  mark: number;
  color: string;
  label: string;
}) {
  const T = useT();
  const grow = useEntrance(150, 650);
  const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%` as const;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.min(1, fill) * 100) }}
      style={{ height: 6, borderRadius: 3, backgroundColor: T.meterBg, marginVertical: 6 }}
    >
      <Animated.View
        style={{
          width: pct(fill),
          minWidth: fill > 0 ? 6 : 0,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
          transformOrigin: "left",
          transform: [{ scaleX: grow }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: pct(mark),
          top: -2,
          width: 2,
          height: 10,
          marginLeft: -1,
          borderRadius: 1,
          backgroundColor: T.fg3,
        }}
      />
    </View>
  );
}

export function Steps({ items }: { items: StepItem[] }) {
  const T = useT();
  return (
    <View>
      {items.map((it, i) => {
        const S = {
          done: [T.b1Bg, T.b1Bg, T.b1Fg, "✓", T.fg, "500", T.b1Bg],
          cur: [T.cardBg, T.tint, T.tint, String(i + 1), T.fg, "600", T.sep],
          warn: [T.stepWarnBg, T.warnBd, T.warnBd, "!", T.warnFg, "600", T.sep],
          todo: ["transparent", T.sep, T.fg3, String(i + 1), T.fg2, "400", T.sep],
          skip: ["transparent", T.sep, T.fg3, "–", T.fg3, "400", T.sep],
        }[it.st] as string[];
        const last = i === items.length - 1;
        return (
          <FadeInUp key={it.label} index={i} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ alignItems: "center", width: 24 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: S[0],
                  borderWidth: it.st === "done" ? 0 : 2,
                  borderColor: S[1],
                  borderStyle: it.st === "skip" ? "dashed" : "solid",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Txt style={{ color: S[2], fontSize: 12, fontWeight: "700" }}>{S[3]}</Txt>
              </View>
              {!last ? (
                <View style={{ width: 2, flex: 1, minHeight: 14, backgroundColor: S[6] }} />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : 12 }}>
              <Txt
                style={{
                  ...TYPE.subhead,
                  color: S[4],
                  fontWeight: S[5] as TextStyle["fontWeight"],
                }}
              >
                {it.label}
              </Txt>
              {it.sub ? <Txt style={{ ...TYPE.footnote, color: T.fg2 }}>{it.sub}</Txt> : null}
            </View>
          </FadeInUp>
        );
      })}
    </View>
  );
}

/* ───────────── Messages ───────────── */

export function Banner({
  tone,
  title,
  body,
  items,
  act,
  h,
}: {
  tone: Tone;
  title: string;
  body?: string;
  h?: string;
  items?: { where: string; msg: string; onPress?: () => void }[];
  act?: { label: string; onPress: () => void };
}) {
  const T = useT();
  const tn = T.tones[tone];
  return (
    <Section h={h} style={{ marginBottom: 12 }}>
      <View
        accessibilityRole="alert"
        style={{
          marginHorizontal: 16,
          backgroundColor: tn.bg,
          borderRadius: 10,
          paddingVertical: 8,
          paddingHorizontal: 12,
          gap: 4,
        }}
      >
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <View style={{ height: TYPE.footnote.lineHeight, justifyContent: "center" }}>
            <Icon name={tn.icon as IconName} size={15} color={tn.fg} />
          </View>
          <Txt style={{ flex: 1, color: T.fg, ...TYPE.footnote }}>
            <Txt style={{ color: tn.fg, fontWeight: "600" }}>
              {body && !/[.!?:…]$/.test(title) ? `${title}.` : title}
            </Txt>
            {body ? ` ${body}` : null}
          </Txt>
        </View>
        {items?.map((e) => (
          <Pressable
            key={e.where + e.msg}
            onPress={e.onPress}
            style={{ marginLeft: 23, paddingVertical: 2 }}
          >
            <Txt style={{ ...TYPE.footnote, color: T.fg }}>
              <Txt style={{ fontWeight: "600", color: tn.fg }}>{e.where}</Txt> {e.msg}
            </Txt>
          </Pressable>
        ))}
        {act ? (
          <Pressable
            onPress={act.onPress}
            hitSlop={8}
            style={{ marginLeft: 23, paddingVertical: 2 }}
            accessibilityRole="button"
          >
            <Txt style={{ color: T.tint, fontWeight: "600", ...TYPE.footnote }}>{act.label}</Txt>
          </Pressable>
        ) : null}
      </View>
    </Section>
  );
}

export function Done({
  tone = "success",
  icon = "check",
  title,
  body,
}: {
  tone?: Tone;
  icon?: IconName;
  title: string;
  body?: string;
}) {
  const T = useT();
  const pop = useSpringIn();
  const tn = T.tones[tone];
  return (
    <Section>
      <View
        style={{
          marginHorizontal: 16,
          alignItems: "center",
          paddingVertical: 28,
          paddingHorizontal: 20,
          gap: 12,
        }}
      >
        <Animated.View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: tn.bg,
            alignItems: "center",
            justifyContent: "center",
            opacity: pop,
            transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
          }}
        >
          <Icon name={icon} size={34} color={tn.fg} />
        </Animated.View>
        <Txt style={{ fontSize: 20, lineHeight: 26, fontWeight: "700", textAlign: "center" }}>
          {title}
        </Txt>
        {body ? (
          <Txt style={{ color: T.fg2, ...TYPE.subhead, textAlign: "center" }}>{body}</Txt>
        ) : null}
      </View>
    </Section>
  );
}

export function Note({ text, center }: { text: string; center?: boolean }) {
  const T = useT();
  return (
    <Txt
      style={{
        marginHorizontal: 24,
        marginBottom: T.secGap,
        color: T.fg2,
        ...TYPE.footnote,
        textAlign: center ? "center" : "left",
      }}
    >
      {text}
    </Txt>
  );
}

/* ───────────── Buttons ───────────── */

export type BtnKind = "primary" | "secondary" | "danger" | "text";

export function Btn({
  label,
  onPress,
  kind = "primary",
  dis,
  icon,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: BtnKind;
  dis?: boolean;
  icon?: IconName;
  small?: boolean;
}) {
  const T = useT();
  const K = {
    primary: [T.b1Bg, T.b1Fg, 0, "transparent"],
    secondary: [T.b2Bg, T.b2Fg, T.b2Bw, T.b2Bd],
    danger: [T.ios ? "transparent" : T.tones.danger.bg, T.danger, 0, "transparent"],
    text: ["transparent", T.tint, 0, "transparent"],
  }[kind] as [string, string, number, string];
  const press = usePressScale(dis ? 1 : 0.97);
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        onPress={onPress}
        disabled={dis}
        {...press.handlers}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!dis }}
        style={({ pressed }) => ({
          // minHeight, not height: large system text wraps the label instead of clipping it.
          minHeight: small ? 40 : T.btnH,
          paddingVertical: 6,
          borderRadius: T.btnR,
          backgroundColor: K[0],
          borderWidth: K[2],
          borderColor: K[3],
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingHorizontal: 20,
          opacity: dis ? 0.38 : pressed ? 0.88 : 1,
        })}
      >
        {icon ? <Icon name={icon} size={18} color={K[1]} /> : null}
        <Txt
          style={{
            flexShrink: 1,
            textAlign: "center",
            color: K[1],
            fontSize: small ? 15 : T.btnFs,
            fontWeight: T.btnFw,
          }}
        >
          {label}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

export function Btns({ children }: { children: React.ReactNode }) {
  const T = useT();
  return <View style={{ marginHorizontal: 16, marginBottom: T.secGap, gap: 8 }}>{children}</View>;
}

/* ───────────── Form fields ───────────── */

/** A titled group of fields. iOS: inset white card. Material: stacked outlined fields. */
export function Fields({
  h,
  f,
  card,
  children,
}: {
  h?: string;
  f?: string;
  /**
   * Settings-style group: on Material the controls sit in the same tonal card as list rows, with
   * the list's heading inset, so a screen that mixes lists and controls (Me) lines up. iOS fields
   * are a grouped card already.
   */
  card?: boolean;
  children?: React.ReactNode;
}) {
  const T = useT();
  const kids = React.Children.toArray(children).filter(Boolean);
  const mdCard = card && !T.ios;
  // Material form fields sit flush in the 16dp margin, so their heading lines up with the field
  // labels; iOS headings (and Material cards) keep the inset that matches text inside a card.
  return (
    <Section h={h} f={f} px={T.ios || mdCard ? undefined : 16}>
      <View
        style={{
          marginHorizontal: 16,
          borderRadius: T.ios || mdCard ? T.listR : 0,
          overflow: "hidden",
          gap: T.fGap,
          backgroundColor: mdCard ? T.rowBg : T.fRowBg,
          ...(mdCard
            ? {
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: T.cardBd,
              }
            : null),
        }}
      >
        {kids.map((k, i) => (
          <View key={i}>
            {k}
            {T.ios && i < kids.length - 1 ? (
              <View
                style={{ height: StyleSheet.hairlineWidth, backgroundColor: T.sep, marginLeft: 16 }}
              />
            ) : null}
          </View>
        ))}
      </View>
    </Section>
  );
}

function FieldBox({
  label,
  sub,
  hint,
  err,
  children,
  row,
  focused,
  aside,
  outlined,
}: {
  label: string;
  sub?: string;
  hint?: string;
  err?: string;
  children: React.ReactNode;
  row?: boolean;
  /** Highlights the label while the field has focus. */
  focused?: boolean;
  /** Shown at the end of the hint row, e.g. a character counter. */
  aside?: React.ReactNode;
  outlined?: boolean;
}) {
  const T = useT();
  const note = err || hint;
  return (
    <View
      style={{
        paddingVertical: outlined ? 0 : T.ios ? 8 : 2,
        paddingHorizontal: T.ios && !outlined ? 16 : 0,
        gap: T.ios ? 2 : 4,
      }}
    >
      <View style={row ? { flexDirection: "row", alignItems: "center", gap: 12 } : undefined}>
        <View style={row ? { flex: 1 } : undefined}>
          <Txt
            style={{
              ...TYPE.footnote,
              color: err ? T.danger : focused ? T.tint : T.fg2,
              fontWeight: outlined ? "600" : "500",
              marginBottom: outlined ? 6 : 0,
            }}
          >
            {label}
          </Txt>
          {sub ? <Txt style={{ ...TYPE.caption, color: T.fg3 }}>{sub}</Txt> : null}
        </View>
        {children}
      </View>
      {note || aside ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <Txt
            accessibilityLiveRegion={err ? "polite" : undefined}
            style={{ flex: 1, ...TYPE.caption, color: err ? T.danger : T.fg2 }}
          >
            {note ?? ""}
          </Txt>
          {aside}
        </View>
      ) : null}
    </View>
  );
}

/** Rows a text area shows before it scrolls, and their height. */
const AREA_LINE = 22;

/** A colour at about 45% opacity, for rings that mark state without a hard edge. */
const soft = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}73` : hex);

const inputStyle = (
  T: Tokens,
  err?: string,
  multiline?: boolean,
  focused?: boolean,
  rows = 3,
): TextStyle => ({
  minHeight: multiline ? rows * AREA_LINE + (T.ios ? 8 : 20) : T.inH,
  // Material fields are borderless wells; focus and errors show as a soft ring of constant width,
  // so the text doesn't shift. iOS cells stay borderless.
  borderWidth: T.ios ? (err ? 1.5 : 0) : 1.5,
  borderColor: err ? soft(T.danger) : focused && !T.ios ? soft(T.tint) : "transparent",
  borderRadius: T.inR,
  backgroundColor: err && !T.ios ? T.tones.danger.bg : T.inBg,
  paddingHorizontal: T.ios ? 0 : 12,
  paddingVertical: multiline ? (T.ios ? 4 : 10) : 0,
  fontSize: 16,
  lineHeight: multiline ? AREA_LINE : undefined,
  color: T.fg,
  textAlignVertical: multiline ? "top" : "center",
  // The coloured border is the focus cue; drop the browser's own focus ring on web (React Native
  // Web accepts "none", which React Native's native types don't list).
  ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : null),
});

export function Input({
  label,
  value,
  onChangeText,
  ph,
  keyboardType,
  secure,
  hint,
  err,
  multiline,
  rows,
  max,
  autoCapitalize,
  autoComplete,
  inputRef,
  onFocus,
  outlined,
  leadingIcon,
  autoCorrect,
  returnKeyType,
  onSubmitEditing,
  submitBehavior,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  ph?: string;
  keyboardType?: KeyboardTypeOptions;
  secure?: boolean;
  hint?: string;
  err?: string;
  multiline?: boolean;
  /** Lines a text area shows before scrolling (default 3). */
  rows?: number;
  /** Maximum length; a text area also shows a counter. */
  max?: number;
  autoCapitalize?: "none" | "sentences" | "words";
  autoComplete?: any;
  inputRef?: React.Ref<TextInputInstance>;
  onFocus?: () => void;
  outlined?: boolean;
  leadingIcon?: IconName;
  autoCorrect?: boolean;
  returnKeyType?: React.ComponentProps<typeof TextInput>["returnKeyType"];
  onSubmitEditing?: () => void;
  submitBehavior?: React.ComponentProps<typeof TextInput>["submitBehavior"];
}) {
  const T = useT();
  const font = useInputFont();
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);
  const near = max != null && value.length >= max * 0.9;
  const counter =
    multiline && max != null ? (
      <Txt
        accessibilityLabel={`${value.length} of ${max} characters`}
        style={{
          ...TYPE.caption,
          color: near ? T.warnFg : T.fg3,
          fontVariant: ["tabular-nums"],
        }}
      >
        {`${value.length}/${max}`}
      </Txt>
    ) : null;
  const field = (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onChangeText}
      placeholder={ph}
      placeholderTextColor={T.fg3}
      keyboardType={keyboardType}
      secureTextEntry={secure && hidden}
      multiline={multiline}
      maxLength={max}
      autoCapitalize={autoCapitalize}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmitEditing}
      submitBehavior={submitBehavior}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      accessibilityLabel={label}
      selectionColor={T.tint}
      cursorColor={T.tint}
      style={[
        inputStyle(T, err, multiline, focused, rows),
        outlined
          ? {
              minHeight: 56,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: err ? T.danger : focused ? T.tint : T.sep,
              backgroundColor: T.cardBg,
            }
          : null,
        font,
        leadingIcon ? { paddingStart: 44 } : null,
        secure ? (outlined ? { paddingEnd: 54 } : { paddingRight: 48 }) : null,
      ]}
    />
  );
  return (
    <FieldBox
      label={label}
      hint={hint}
      err={err}
      focused={focused}
      aside={counter}
      outlined={outlined}
    >
      {secure || leadingIcon ? (
        <View style={{ justifyContent: "center" }}>
          {field}
          {leadingIcon ? (
            <View
              pointerEvents="none"
              accessible={false}
              style={{ position: "absolute", start: 14 }}
            >
              <Icon name={leadingIcon} size={19} color={focused ? T.tint : T.fg2} />
            </View>
          ) : null}
          {secure ? (
            <Pressable
              onPress={() => setHidden((h) => !h)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={hidden ? "Show password" : "Hide password"}
              style={{
                position: "absolute",
                ...(outlined ? { end: 6 } : { right: T.ios ? 0 : 4 }),
                height: "100%",
                width: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={hidden ? "eye" : "eyeOff"} size={20} color={T.fg2} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        field
      )}
    </FieldBox>
  );
}

export function ReadOnly({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const T = useT();
  return (
    <FieldBox label={label} hint={sub}>
      <View
        style={[
          inputStyle(T),
          {
            justifyContent: "center",
            borderColor: "transparent",
            backgroundColor: T.roBg,
          },
        ]}
      >
        <Txt style={{ color: T.fg2, fontSize: 16 }}>{value}</Txt>
      </View>
    </FieldBox>
  );
}

export function Seg<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [K, string][];
  /** Nothing is selected while undefined, so a required choice must be made. */
  value: K | undefined;
  onChange: (k: K) => void;
}) {
  const T = useT();
  return (
    <FieldBox label={label}>
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: "row",
          minHeight: T.segH,
          borderRadius: T.segR,
          backgroundColor: T.segBg,
          padding: T.ios ? 2 : 3,
          overflow: "hidden",
          marginTop: T.ios ? 6 : 0,
        }}
      >
        {options.map(([k, l]) => {
          const on = k === value;
          return (
            <Pressable
              key={k}
              onPress={() => onChange(k)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 6,
                paddingHorizontal: 6,
                paddingVertical: 4,
                borderRadius: T.ios ? 7 : T.segR - 3,
                backgroundColor: on ? T.segOn : "transparent",
                // A raised pill on light tracks; dark tracks show the selection by colour.
                ...(on && (T.ios || !T.dark)
                  ? {
                      shadowColor: "#000",
                      shadowOpacity: 0.12,
                      shadowRadius: 4,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 1,
                    }
                  : null),
              }}
            >
              {!T.ios && on ? <Icon name="check" size={16} color={T.icFg} /> : null}
              <Txt
                numberOfLines={2}
                style={{
                  flexShrink: 1,
                  textAlign: "center",
                  fontSize: 14,
                  fontWeight: on ? "600" : "500",
                  color: T.fg,
                }}
              >
                {l}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </FieldBox>
  );
}

export function Stepper({
  label,
  sub,
  value,
  onChange,
  step,
  err,
}: {
  label: string;
  sub?: string;
  value: string;
  onChange: (v: string) => void;
  step: number;
  err?: string;
}) {
  const T = useT();
  const semibold = useInputFont("semibold");
  const { isCompact, largeText } = useResponsive();
  // On narrow phones or with large text, the 170dp of controls go under the label.
  const stack = isCompact || largeText;
  const n = parseInt(value.replace(/[^0-9]/g, ""), 10) || 0;
  const btn = (icon: IconName, next: number, a11y: string) => (
    <Pressable
      onPress={() => onChange(String(Math.max(0, next)))}
      accessibilityRole="button"
      accessibilityLabel={`${a11y} ${label}`}
      hitSlop={6}
      style={{
        width: T.ios ? 34 : 40,
        height: T.ios ? 34 : 40,
        borderRadius: T.ios ? 8 : 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: T.stepperBg,
      }}
    >
      <Icon name={icon} size={18} color={T.fg} />
    </Pressable>
  );
  return (
    <FieldBox label={label} sub={sub} err={err} row={!stack}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginTop: stack ? 6 : 0,
        }}
      >
        {btn("minus", n - step, "Decrease")}
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          accessibilityLabel={label}
          placeholder="0"
          placeholderTextColor={T.fg3}
          selectionColor={T.tint}
          style={[
            {
              width: stack ? undefined : 76,
              flex: stack ? 1 : undefined,
              minHeight: T.ios ? 34 : 40,
              textAlign: "center",
              fontSize: 16,
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
              color: T.fg,
              borderRadius: T.ios ? 8 : 10,
              backgroundColor: T.stepperInBg,
              borderWidth: err ? 1.5 : 0,
              borderColor: err ? soft(T.danger) : "transparent",
            },
            semibold,
          ]}
        />
        {btn("plus", n + step, "Increase")}
      </View>
    </FieldBox>
  );
}

export function Toggle({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const T = useT();
  // A switch reads as a list row: title at row size with a footnote under it, not a small field
  // label, so it matches the rows around it on settings screens.
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: T.rowMin - 12,
        paddingHorizontal: T.ios ? 16 : 0,
        paddingVertical: T.ios ? 6 : 0,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt>{label}</Txt>
        {sub ? <Txt style={{ ...TYPE.footnote, color: T.fg2 }}>{sub}</Txt> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: T.switchOn, false: T.switchOff }}
        thumbColor={T.ios ? undefined : value ? (T.dark ? T.b1Fg : "#fff") : T.switchThumbOff}
      />
    </View>
  );
}

export function Check({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const T = useT();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: T.ios ? 11 : 8,
        paddingHorizontal: T.ios ? 16 : 0,
        minHeight: 44,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: T.ios ? 12 : 4,
          borderWidth: value ? 0 : 2,
          borderColor: T.ios ? T.fg3 : T.fg2,
          backgroundColor: value ? T.tint : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {value ? <Icon name="check" size={16} color={T.b1Fg} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt style={{ fontSize: 16 }}>{label}</Txt>
        {sub ? <Txt style={{ ...TYPE.footnote, color: T.fg2 }}>{sub}</Txt> : null}
      </View>
    </Pressable>
  );
}

export function Pick({
  label,
  value,
  sub,
  onPress,
}: {
  label: string;
  value: string;
  sub?: string;
  onPress: () => void;
}) {
  const T = useT();
  return (
    <FieldBox label={label}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: T.ios ? 34 : 56,
          borderWidth: T.inBw,
          borderColor: T.inBd,
          borderRadius: T.inR,
          backgroundColor: T.inBg,
          paddingHorizontal: T.ios ? 0 : 14,
          paddingVertical: T.ios ? 0 : 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Txt style={{ fontSize: 16, fontWeight: "500" }}>{value}</Txt>
          {sub ? <Txt style={{ ...TYPE.footnote, color: T.fg2 }}>{sub}</Txt> : null}
        </View>
        <Icon name="chevD" size={20} color={T.fg2} />
      </Pressable>
    </FieldBox>
  );
}

/** Dropdown as a row that opens a bottom sheet of choices. */
export function Select({
  label,
  value,
  options,
  onChange,
  err,
  loading,
}: {
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange: (v: string) => void;
  err?: string;
  /** Show a skeleton in place of the field while its options load. */
  loading?: boolean;
}) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.v === value);
  if (loading)
    return (
      <FieldBox label={label}>
        <Skeleton h={T.inH - 12} style={{ marginVertical: 6 }} />
      </FieldBox>
    );
  return (
    <>
      <FieldBox label={label} err={err}>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${cur?.l ?? "Choose"}`}
          style={[inputStyle(T, err), { flexDirection: "row", alignItems: "center" }]}
        >
          <Txt style={{ flex: 1, fontSize: 16, color: cur && cur.v ? T.fg : T.fg3 }}>
            {cur?.l || "Choose…"}
          </Txt>
          <Icon name="chevD" size={20} color={T.fg2} />
        </Pressable>
      </FieldBox>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <List>
          {options
            .filter((o) => o.v !== "")
            .map((o) => (
              <Row
                key={o.v}
                t={o.l}
                ic={o.v === value ? "check" : undefined}
                fw={o.v === value ? "600" : "400"}
                onPress={() => {
                  onChange(o.v);
                  setOpen(false);
                }}
              />
            ))}
        </List>
      </Sheet>
    </>
  );
}

/* ───────────── Misc sections ───────────── */

export function Search({
  value,
  onChangeText,
  ph,
}: {
  value: string;
  onChangeText: (v: string) => void;
  ph: string;
}) {
  const T = useT();
  const font = useInputFont();
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: T.ios ? 16 : 20,
        height: T.srH,
        borderRadius: T.srR,
        backgroundColor: T.srBg,
        // Android's search field is white like the sheets and screens it sits on; the outline keeps
        // it visible there. iOS fills it grey instead.
        borderWidth: T.ios ? 0 : 1,
        borderColor: T.outline,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: T.ios ? 10 : 18,
        gap: T.ios ? 6 : 14,
      }}
    >
      <Icon name="search" size={18} color={T.fg2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={ph}
        placeholderTextColor={T.placeholder}
        accessibilityLabel={ph}
        returnKeyType="search"
        selectionColor={T.tint}
        style={[{ flex: 1, fontSize: 16, color: T.fg, height: "100%" }, font]}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} accessibilityLabel="Clear search" hitSlop={8}>
          <Icon name="x" size={18} color={T.fg2} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Progress({ count, step, label }: { count: number; step: number; label: string }) {
  const T = useT();
  return (
    <View style={{ marginHorizontal: 16, marginBottom: T.secGap, gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {Array.from({ length: count }).map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= step ? T.tint : T.sep,
            }}
          />
        ))}
      </View>
      <Txt style={{ ...TYPE.footnote, color: T.fg2 }}>{label}</Txt>
    </View>
  );
}

export function Avatar({ ini, size = 64 }: { ini: string; size?: number }) {
  const T = useT();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: T.icBg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Txt style={{ color: T.icFg, fontSize: size * 0.38, fontWeight: "600" }}>{ini}</Txt>
    </View>
  );
}

export function SigPreview({ d, w = 96, h = 40 }: { d: string; w?: number; h?: number }) {
  return (
    <View style={{ width: w, height: h, backgroundColor: "#fff", borderRadius: 6 }}>
      <Svg width={w} height={h} viewBox="0 0 320 140">
        <Path
          d={d}
          stroke="#111"
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

export function PhotoView({ uri, h = 200 }: { uri: string; h?: number }) {
  const T = useT();
  return (
    <Image
      source={{ uri }}
      accessibilityIgnoresInvertColors
      style={{ width: "100%", height: h, borderRadius: T.tileR, backgroundColor: T.imgBg }}
      resizeMode="cover"
    />
  );
}

/* ───────────── Bottom sheet ───────────── */

export function Sheet({
  visible,
  title,
  sub,
  icon,
  tone = "success",
  onClose,
  header,
  children,
}: {
  visible: boolean;
  title: string;
  /** One line under the title saying what the sheet is for. */
  sub?: string;
  /** Alert-style sheets lead with a tinted icon badge in the tone's colour. */
  icon?: IconName;
  tone?: Tone;
  onClose: () => void;
  /** Stays above the scrolling content, e.g. a search field for a long list. */
  header?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const T = useT();
  const insets = useSafeAreaInsets();
  const { isShort } = useResponsive();
  const tn = T.tones[tone];
  // The scrim fades while the sheet rises on a soft spring, rather than both sliding together.
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    Animated.spring(rise, {
      toValue: 1,
      damping: 22,
      stiffness: 220,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [visible, rise]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: T.scrim }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          style={{
            backgroundColor: T.sheetBg,
            borderTopLeftRadius: T.sheetR,
            borderTopRightRadius: T.sheetR,
            borderWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: 0,
            borderColor: T.cardBd,
            // Centred and capped on tablets; taller on short windows so content still fits.
            width: "100%",
            maxWidth: MAX_SHEET_WIDTH,
            alignSelf: "center",
            maxHeight: isShort ? "94%" : "82%",
            paddingBottom: insets.bottom + 12,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            transform: [
              { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [64, 0] }) },
            ],
            opacity: rise.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
          }}
        >
          <View style={{ alignItems: "center", paddingTop: 8 }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: T.grab,
                opacity: 0.5,
              }}
            />
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: icon || sub ? "flex-start" : "center",
              gap: 12,
              paddingLeft: 20,
              paddingRight: 12,
              paddingTop: 12,
              paddingBottom: 14,
            }}
          >
            {icon ? (
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: tn.bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={icon} size={20} color={tn.fg} />
              </View>
            ) : null}
            <View style={{ flex: 1, gap: 2, paddingTop: icon ? 1 : 0 }}>
              <Txt
                accessibilityRole="header"
                style={{ fontSize: 18, lineHeight: 24, fontWeight: "600" }}
              >
                {title}
              </Txt>
              {sub ? <Txt style={{ ...TYPE.footnote, color: T.fg2 }}>{sub}</Txt> : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? T.rowPress : T.meterBg,
              })}
            >
              <Icon name="x" size={16} color={T.fg2} />
            </Pressable>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: T.sep }} />
          {header ? <View style={{ paddingTop: 12 }}>{header}</View> : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: header ? 0 : 12 }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ───────────── Skeleton loaders ───────────── */

/** Pulses while content loads; holds still when the phone asks for reduced motion. */
function usePulse() {
  const reduce = useReducedMotion();
  const [v] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    if (reduce) {
      v.setValue(0.55);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.55, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, reduce]);
  return v;
}

/** A placeholder bar shaped like the content that is loading. */
export function Skeleton({
  w = "100%",
  h = 14,
  r = 6,
  style,
}: {
  w?: number | `${number}%`;
  h?: number;
  r?: number;
  style?: ViewStyle;
}) {
  const T = useT();
  const opacity = usePulse();
  return (
    <Animated.View
      style={[{ width: w, height: h, borderRadius: r, backgroundColor: T.skelBg, opacity }, style]}
    />
  );
}

/** List rows that hold the place of a list while it loads: icon, title and subtitle. */
export function SkeletonList({ rows = 4, h }: { rows?: number; h?: string }) {
  const T = useT();
  return (
    <Section h={h}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading"
        style={{ marginHorizontal: 16, borderRadius: T.listR, overflow: "hidden", gap: T.listGap }}
      >
        {Array.from({ length: rows }).map((_, i) => (
          <View
            key={i}
            style={{
              backgroundColor: T.rowBg,
              minHeight: T.rowMin,
              paddingVertical: T.rowPy,
              paddingHorizontal: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Skeleton w={T.icBox} h={T.icBox} r={T.icR} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton w={i % 2 ? "55%" : "70%"} h={14} />
              <Skeleton w={i % 2 ? "40%" : "48%"} h={12} />
            </View>
          </View>
        ))}
      </View>
    </Section>
  );
}
