import type { TransportMode } from './types.ts';

export interface ModeInfo {
  mode: TransportMode;
  label: string;
  /** Ionicons glyph name used by the mobile UI. */
  icon: string;
  /** Whether the user's share of emissions depends on vehicle occupancy. */
  occupancyApplies: boolean;
  isPublicTransport: boolean;
  isActiveTravel: boolean;
  /** Whether this mode is a car-like, private motorised mode (used by insights and goals). */
  isPrivateMotorised: boolean;
}

export const MODE_INFO: Record<TransportMode, ModeInfo> = {
  walking: { mode: 'walking', label: 'Walking', icon: 'walk', occupancyApplies: false, isPublicTransport: false, isActiveTravel: true, isPrivateMotorised: false },
  cycling: { mode: 'cycling', label: 'Cycling', icon: 'bicycle', occupancyApplies: false, isPublicTransport: false, isActiveTravel: true, isPrivateMotorised: false },
  motorcycle: { mode: 'motorcycle', label: 'Motorcycle / scooter', icon: 'speedometer', occupancyApplies: true, isPublicTransport: false, isActiveTravel: false, isPrivateMotorised: true },
  car: { mode: 'car', label: 'Private car', icon: 'car', occupancyApplies: true, isPublicTransport: false, isActiveTravel: false, isPrivateMotorised: true },
  taxi: { mode: 'taxi', label: 'Taxi / ride-hailing', icon: 'car-sport', occupancyApplies: false, isPublicTransport: false, isActiveTravel: false, isPrivateMotorised: true },
  bus: { mode: 'bus', label: 'Bus', icon: 'bus', occupancyApplies: false, isPublicTransport: true, isActiveTravel: false, isPrivateMotorised: false },
  metro: { mode: 'metro', label: 'MRT / metro', icon: 'subway', occupancyApplies: false, isPublicTransport: true, isActiveTravel: false, isPrivateMotorised: false },
  train: { mode: 'train', label: 'Train (conventional rail)', icon: 'train', occupancyApplies: false, isPublicTransport: true, isActiveTravel: false, isPrivateMotorised: false },
  hsr: { mode: 'hsr', label: 'High-speed rail', icon: 'train', occupancyApplies: false, isPublicTransport: true, isActiveTravel: false, isPrivateMotorised: false },
  other_public: { mode: 'other_public', label: 'Other public transport', icon: 'boat', occupancyApplies: false, isPublicTransport: true, isActiveTravel: false, isPrivateMotorised: false },
  unknown: { mode: 'unknown', label: 'Unknown / unclassified', icon: 'help-circle', occupancyApplies: false, isPublicTransport: false, isActiveTravel: false, isPrivateMotorised: false },
};

export function modeLabel(mode: TransportMode): string {
  return MODE_INFO[mode].label;
}
