/**
 * Restrained, accessible SVG charts.
 *  - BarChart: single-series time series (one hue, no legend; the card title names the measure).
 *    Bars have 4 px rounded data-ends anchored to the baseline and a 2 px gap. Tap a bar to see its value.
 *  - ModeBreakdown: horizontal bars, each labelled with the mode name and icon, so identity never
 *    depends on colour. Doubles as the table view (kg, share, trips, km).
 */
import React, { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { formatKg, formatKm } from '@core/calc.ts';
import type { ModeStats } from '@core/analytics.ts';
import { MODE_INFO } from '@core/modes.ts';
import { ModeIcon, Row, T } from './components';
import { radius, spacing, usePalette } from './theme';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export function BarChart({ data, height = 140, formatValue = formatKg, emptyLabel = 'No data' }: { data: BarDatum[]; height?: number; formatValue?: (v: number) => string; emptyLabel?: string }) {
  const c = usePalette();
  const { width: screenW } = useWindowDimensions();
  const width = Math.max(200, screenW - spacing.lg * 2 - spacing.lg * 2);
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const n = data.length;
  const gap = 2;
  const barW = n ? Math.max(2, (width - gap * (n - 1)) / n) : 0;
  const total = data.reduce((a, d) => a + d.value, 0);
  const peak = data.reduce<BarDatum | null>((a, d) => (!a || d.value > a.value ? d : a), null);
  const labelEvery = n > 16 ? Math.ceil(n / 8) : 1;
  const summary = max > 0 ? `Bar chart, ${n} bars, total ${formatValue(total)}, highest ${peak?.label} at ${formatValue(peak?.value ?? 0)}.` : emptyLabel;

  return (
    <View accessible accessibilityLabel={summary} style={{ gap: 4 }}>
      <View style={{ height: 20 }}>
        {selected != null && data[selected] ? (
          <T variant="small" style={{ fontWeight: '600' }}>{`${data[selected].label}: ${formatValue(data[selected].value)}`}</T>
        ) : (
          <T variant="small" muted>{max > 0 ? 'Tap a bar for its value' : emptyLabel}</T>
        )}
      </View>
      <View style={{ width, height }}>
        <Svg width={width} height={height}>
          <Line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke={c.border} strokeWidth={1} />
          {data.map((d, i) => {
            const h = max > 0 ? (d.value / max) * (height - 4) : 0;
            const x = i * (barW + gap);
            return (
              <Path
                key={d.key}
                d={roundedTopBar(x, height - h - 1, barW, h, 4)}
                fill={c.primary}
                opacity={selected == null || selected === i ? 1 : 0.45}
              />
            );
          })}
        </Svg>
        {/* Hit targets larger than the marks (full column height). */}
        <View style={{ position: 'absolute', left: 0, top: 0, width, height, flexDirection: 'row' }}>
          {data.map((d, i) => (
            <Pressable
              key={d.key}
              accessibilityRole="button"
              accessibilityLabel={`${d.label}: ${formatValue(d.value)}`}
              onPress={() => setSelected(selected === i ? null : i)}
              style={{ width: barW + (i < n - 1 ? gap : 0), height }}
            />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', width }}>
        {data.map((d, i) => (
          <View key={d.key} style={{ width: barW + (i < n - 1 ? gap : 0), alignItems: 'center', overflow: 'visible' }}>
            {i % labelEvery === 0 ? (
              <T variant="small" muted numberOfLines={1} style={{ fontSize: 10, width: Math.max(barW * labelEvery, 24), textAlign: 'center' }}>{d.label}</T>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export function ModeBreakdown({ byMode, totalKg }: { byMode: ModeStats[]; totalKg: number }) {
  const c = usePalette();
  if (!byMode.length) return <T muted>No trips in this period.</T>;
  const max = Math.max(...byMode.map((m) => m.emissionsKg), 0);
  return (
    <View style={{ gap: spacing.md }}>
      {byMode.map((m) => {
        const share = totalKg > 0 ? m.emissionsKg / totalKg : 0;
        const unavailable = m.unavailableTrips > 0 && m.unavailableTrips === m.trips;
        return (
          <View
            key={m.mode}
            accessible
            accessibilityLabel={`${MODE_INFO[m.mode].label}: ${unavailable ? 'no emission factor' : formatKg(m.emissionsKg)}, ${(share * 100).toFixed(0)} percent, ${m.trips} trips, ${formatKm(m.distanceKm)}`}
            style={{ gap: 4 }}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Row style={{ flex: 1 }}>
                <ModeIcon mode={m.mode} size={18} />
                <T variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>{MODE_INFO[m.mode].label}</T>
              </Row>
              <T variant="small" style={{ fontWeight: '600' }}>{unavailable ? 'n/a' : `${formatKg(m.emissionsKg)} · ${(share * 100).toFixed(0)}%`}</T>
            </Row>
            <View style={{ height: 8, backgroundColor: c.surfaceAlt, borderRadius: radius.pill, overflow: 'hidden' }}>
              <View style={{ height: 8, width: `${max > 0 ? (m.emissionsKg / max) * 100 : 0}%`, backgroundColor: c.primary, borderRadius: radius.pill }} />
            </View>
            <T variant="small" muted>
              {`${m.trips} trip${m.trips === 1 ? '' : 's'} · ${formatKm(m.distanceKm)}${m.unavailableTrips ? ` · ${m.unavailableTrips} without factor` : ''}`}
            </T>
          </View>
        );
      })}
    </View>
  );
}
