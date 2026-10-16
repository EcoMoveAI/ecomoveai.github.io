// The background location task must be defined in the global scope before the router mounts,
// because the OS may launch the app headlessly just to deliver locations. (Web: a no-op module.)
import './src/tracking/task';
// Web: register the service worker and catch the early `beforeinstallprompt` event. (Native: no-op.)
import { startPwa } from './src/services/pwa';
import 'expo-router/entry';

startPwa();
