/**
 * UI flow tests: render the real Expo Router app (src/app) in memory with an in-memory SQLite repository and
 * mocked native modules. Covers onboarding, permission denial, manual trip entry, the dashboard and editing.
 * Real-device testing is still required for background location (see docs/TESTING.md).
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { buildAutoTrip } from '@core/trips.ts';
import { getFactorSetOrDefault } from '@core/factors.ts';
import { Repository } from '@/db/repository';
import { createSqlJsDriver } from './sqljsDriver';

const mockState: { repo: Promise<Repository> | null; fgGranted: boolean; canAskAgain: boolean } = { repo: null, fgGranted: false, canAskAgain: true };

jest.mock('@/db/shared', () => ({ getRepository: () => mockState.repo }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { Other: 1 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: mockState.fgGranted, canAskAgain: mockState.canAskAgain })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  // The user taps "Don't allow" in the system dialog.
  requestForegroundPermissionsAsync: jest.fn(async () => {
    mockState.fgGranted = false;
    mockState.canAskAgain = false;
    return { granted: false, canAskAgain: false, status: 'denied' };
  }),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  hasServicesEnabledAsync: jest.fn(async () => true),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isAvailableAsync: jest.fn(async () => false) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', CALENDAR: 'calendar' },
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true) }));
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  const Picker = () => <View testID="datetime-picker" />;
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn() } };
});
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: '/cache' } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn() }));

async function freshRepo(onboarded: boolean) {
  const r = new Repository(await createSqlJsDriver());
  await r.migrate();
  if (onboarded) await r.updateSettings({ onboardingComplete: true, accountMode: 'local', privacyConsentVersion: 'test' });
  mockState.repo = Promise.resolve(r);
  return r;
}

const APP_DIR = './src/app';

beforeEach(() => {
  mockState.fgGranted = false;
  mockState.canAskAgain = true;
});

describe('onboarding', () => {
  it('requires consent and lets the user choose on-device mode', async () => {
    const repo = await freshRepo(false);
    renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByText('Get started')).toBeTruthy();
    fireEvent.press(screen.getByText('Get started'));

    expect(await screen.findByText('Your data, your choice')).toBeTruthy();
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont.props.accessibilityState.disabled).toBe(true);
    fireEvent(screen.getByLabelText('I have read the privacy summary'), 'valueChange', true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('How would you like to use EcoMove?')).toBeTruthy();
    // No backend configured in tests: account option is disabled and explained.
    expect(screen.getByText('Accounts are not configured in this build')).toBeTruthy();
    fireEvent.press(screen.getByText('Use on this device'));

    expect(await screen.findByText('Why EcoMove asks for location')).toBeTruthy();
    const s = await repo.getSettings();
    expect(s).toMatchObject({ onboardingComplete: true, accountMode: 'local', trackingEnabled: false });
  });
});

describe('permissions', () => {
  it('handles a denied location permission gracefully and keeps manual entry available', async () => {
    await freshRepo(true);
    renderRouter(APP_DIR, { initialUrl: '/tracking' });
    fireEvent.press(await screen.findByText('Allow while using the app'));
    expect(await screen.findByText('Open system settings')).toBeTruthy();
    expect(screen.queryByText('Start tracking')).toBeNull();
    expect(screen.getByText('Off')).toBeTruthy();
  });
});

describe('manual entry, dashboard and editing', () => {
  it('saves a manual trip with a deterministic calculation and shows it on the dashboard', async () => {
    const repo = await freshRepo(true);
    const r = renderRouter(APP_DIR, { initialUrl: '/trip/new' });
    fireEvent.press(await screen.findByLabelText('Private car'));
    fireEvent.changeText(screen.getByLabelText('Distance (km)'), '10');
    expect(await screen.findByText('1.67 kg CO₂e')).toBeTruthy(); // preview before saving
    expect(screen.getByText(/10 km × 0.16725 kg CO2e\/vehicle-km ÷ 1 occupant/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Save trip' }));

    expect(await screen.findByText('How this was calculated')).toBeTruthy();
    expect(r.getPathname()).toMatch(/^\/trip\//);
    const trips = await repo.listTrips();
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ mode: 'car', detectionSource: 'manual', factorId: 'desnz25-car-average-unknown-vkm' });
  });

  it('shows recorded trips on Home and lets the user confirm an uncertain automatic trip', async () => {
    const repo = await freshRepo(true);
    const now = Date.now();
    const auto = buildAutoTrip(
      {
        startedAt: new Date(now - 40 * 60000).toISOString(), endedAt: new Date(now - 20 * 60000).toISOString(),
        start: { lat: 25.04, lng: 121.5 }, end: { lat: 25.08, lng: 121.5 }, distanceKm: 6, durationS: 1200, endReason: 'stationary', dedupeKey: 'auto:test',
        features: { distanceKm: 6, durationS: 1200, avgSpeedKmh: 18, p85SpeedKmh: 35, maxSpeedKmh: 50, stopCount: 4, sampleCount: 40, meanAccuracyM: 10 },
      },
      { mode: 'car', confidence: 0.3, candidates: [], reasons: [], needsReview: true },
      { id: 'auto-1', now: new Date(now), set: getFactorSetOrDefault(null), keepPreciseCoords: false, defaultOccupancy: () => 1 },
    );
    await repo.saveTrip(auto);

    renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByText("TODAY'S MOBILITY FOOTPRINT")).toBeTruthy();
    expect(screen.getByText('1 trip needs your confirmation')).toBeTruthy();
    expect(screen.getAllByText('1.00 kg').length).toBeGreaterThan(0); // 6 km × 0.16725

    fireEvent.press(screen.getByLabelText(/Private car at .*needs review/));
    expect(await screen.findByText('Which mode was this?')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('MRT / metro'));

    await waitFor(async () => {
      const t = await repo.getTrip('auto-1');
      expect(t).toMatchObject({ mode: 'metro', confirmationStatus: 'edited', factorId: 'twcfp-taipei-metro-2024-pkm' });
      expect(t?.emissionsKg).toBeCloseTo(0.45);
    });
    expect(await screen.findByText('450 g CO₂e')).toBeTruthy();
  });

  it('shows informative empty states instead of fabricated comparisons', async () => {
    await freshRepo(true);
    renderRouter(APP_DIR, { initialUrl: '/insights' });
    expect(await screen.findByText('Nothing recorded for this period')).toBeTruthy();
  });
});
