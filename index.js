/**
 * @format
 */

import { AppRegistry } from 'react-native';
import firebase from '@react-native-firebase/app';

// ✅ 기본 Firebase 앱 보장 (plist 기반)
// 이미 초기화되어 있으면 통과, 아니면 initializeApp() 1회
try {
    firebase.app();
} catch {
    try { firebase.initializeApp(); } catch { }
}

// (선택) 진단 로그
console.log('[RNFB] default app exists =', (() => { try { return !!firebase.app(); } catch { return false; } })());


import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
