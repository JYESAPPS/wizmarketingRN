// App.js — WizMarketing WebView Bridge (push + auth: Google live / Apple&Kakao mock)
// deps: react-native-webview, @react-native-firebase/messaging, @notifee/react-native, react-native-share
// + auth deps: @react-native-google-signin/google-signin, @react-native-firebase/auth

import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@react-native-firebase/app';
import {
  SafeAreaView, BackHandler, StyleSheet, Platform, Alert,
  Linking, LogBox, Animated, Easing,
} from 'react-native';
import { WebView } from 'react-native-webview';
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import Share from 'react-native-share';

import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import SplashScreenRN from './SplashScreenRN';

const APP_VERSION = '1.0.0';
const BOOT_TIMEOUT_MS = 8000;
const MIN_SPLASH_MS = 1200;
const TAG = '[WizApp]';

const App = () => {
  const webViewRef = useRef(null);

  const [splashVisible, setSplashVisible] = useState(true);
  const splashStartRef = useRef(0);
  const splashFade = useRef(new Animated.Value(1)).current;

  const bootTORef = useRef(null);
  const [token, setToken] = useState('');

  const lastNavRef = useRef({ isRoot: false, path: '/', canGoBack: false });
  const lastNavStateRef = useRef({}); // 웹 라우팅 상태 저장

  useEffect(() => { LogBox.ignoreAllLogs(true); }, []);

  // ─────────── Google Sign-In 초기화 ───────────
  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '266866879152-kfquq1i6r89tbqeramjjuaa2csmoegej.apps.googleusercontent.com',
    });
  }, []);

  // ─────────── Web으로 메시지 보내기 ───────────
  const sendToWeb = useCallback((type, payload = {}) => {
    try {
      const msg = JSON.stringify({ type, payload });
      webViewRef.current?.postMessage(msg);
      if (__DEV__) console.log('📡 to Web:', msg);
    } catch (e) { console.log('❌ postMessage error:', e); }
  }, []);

  // ─────────── HW Back 처리 ───────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const nav = lastNavStateRef.current || {};
      console.log('[HW BACK] event fired, nav=', nav);

      const isRoot = nav.isRoot === true;
      const webCanHandle =
        !isRoot || nav.hasBlockingUI === true || nav.needsConfirm === true || nav.canGoBackInWeb === true;

      if (webCanHandle) {
        console.log('[HW BACK] sending BACK_REQUEST');
        sendToWeb('BACK_REQUEST', { nav, at: Date.now() });
        return true;
      }

      Alert.alert('앱 종료', '앱을 종료할까요?', [
        { text: '취소', style: 'cancel' },
        { text: '종료', style: 'destructive', onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    });
    return () => sub.remove();
  }, [sendToWeb]);

  // ─────────── WEB 상태 ACK ───────────
  const handleWebReady = useCallback(() => {
    if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
    sendToWeb('WEB_READY_ACK', { at: Date.now() });
    hideSplashRespectingMin();
  }, [hideSplashRespectingMin, sendToWeb]);

  const handleWebError = useCallback((payload) => {
    if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
    sendToWeb('WEB_ERROR_ACK', { ...(payload || {}), at: Date.now() });
    sendToWeb('OFFLINE_FALLBACK', { reason: payload?.reason || 'js_error', at: Date.now() });
  }, [sendToWeb]);

  // ─────────── 권한: 알림만 ───────────
  const ensureNotificationPermission = useCallback(async () => {
    try {
      const settings = await notifee.requestPermission();
      return !!settings?.authorizationStatus;
    } catch { return false; }
  }, []);

  const replyPermissionStatus = useCallback(({ pushGranted }) => {
    sendToWeb('PERMISSION_STATUS', {
      push: { granted: !!pushGranted, blocked: false },
      token,
    });
  }, [sendToWeb, token]);

  const handleStartSubscription = useCallback(async (payload) => {
    sendToWeb('SUBSCRIPTION_RESULT', {
      success: true,
      product_id: payload?.product_id,
      transaction_id: 'tx_demo_001',
      expires_at:
        payload?.product_type === 'subscription'
          ? Date.now() + 30 * 24 * 3600_000
          : undefined,
    });
  }, [sendToWeb]);

  useEffect(() => {
    (async () => {
      const push = await ensureNotificationPermission();
      replyPermissionStatus({ pushGranted: push });
    })();
  }, [ensureNotificationPermission, replyPermissionStatus]);

  // ─────────── FCM ───────────
  useEffect(() => {
    (async () => {
      try {
        const fcmToken = await messaging().getToken();
        setToken(fcmToken);
        sendToWeb('PUSH_TOKEN', {
          token: fcmToken, platform: Platform.OS, app_version: APP_VERSION,
          install_id: 'unknown', ts: Date.now(),
        });
      } catch (e) { console.log('❌ FCM token error:', e); }
    })();

    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      sendToWeb('PUSH_EVENT', {
        event: 'received',
        title: remoteMessage.notification?.title,
        body: remoteMessage.notification?.body,
        deeplink: remoteMessage.data?.deeplink,
        messageId: remoteMessage.messageId,
        ts: Date.now(),
      });
    });
    return () => unsubscribe();
  }, [sendToWeb]);

  // ─────────── Auth Bridge ───────────
  const handleStartSignin = useCallback(async (payload) => {
    const provider = payload?.provider;
    try {
      if (provider === 'google') {
        // 🔑 Google 로그인 실제 연동
        const { idToken } = await GoogleSignin.signIn();
        const googleCredential = auth.GoogleAuthProvider.credential(idToken);
        const userCred = await auth().signInWithCredential(googleCredential);

        sendToWeb('SIGNIN_RESULT', {
          success: true,
          provider,
          user: {
            uid: userCred.user.uid,
            email: userCred.user.email,
            displayName: userCred.user.displayName,
            photoURL: userCred.user.photoURL,
          },
          expires_at: Date.now() + 6 * 3600 * 1000,
        });
        return;
      }

      if (provider === 'apple') {
        // ⛔ 아직 모의
        sendToWeb('SIGNIN_RESULT', {
          success: true,
          provider,
          user: { id: 'demo_apple', nickname: 'Demo Apple' },
          expires_at: Date.now() + 6 * 3600 * 1000,
        });
        return;
      }

      if (provider === 'kakao') {
        // ⛔ 아직 모의
        sendToWeb('SIGNIN_RESULT', {
          success: false,
          provider,
          error_code: 'kakao_not_configured',
          message: '카카오 인증키/Redirect URI 미설정',
        });
        return;
      }

      throw new Error('unsupported provider');
    } catch (err) {
      sendToWeb('SIGNIN_RESULT', {
        success: false,
        provider,
        error_code: 'auth_error',
        message: String(err?.message || err),
      });
    }
  }, [sendToWeb]);

  const handleStartSignout = useCallback(async () => {
    try {
      await auth().signOut();
      sendToWeb('SIGNOUT_RESULT', { success: true });
    } catch (err) {
      sendToWeb('SIGNOUT_RESULT', {
        success: false,
        error_code: 'signout_error',
        message: String(err?.message || err),
      });
    }
  }, [sendToWeb]);

  // ─────────── Web → App 라우터 ───────────
  const handleCheckPermission = useCallback(async () => {
    const push = await ensureNotificationPermission();
    replyPermissionStatus({ pushGranted: push });
  }, [ensureNotificationPermission, replyPermissionStatus]);

  const handleRequestPermission = useCallback(async () => {
    const push = await ensureNotificationPermission();
    replyPermissionStatus({ pushGranted: push });
  }, [ensureNotificationPermission, replyPermissionStatus]);

  const onMessageFromWeb = useCallback(async (e) => {
    try {
      const raw = e.nativeEvent.data;
      if (typeof raw === 'string' && raw.startsWith('open::')) {
        const url = raw.replace('open::', '');
        try { await Linking.openURL(url); } catch { }
        return;
      }
      const data = JSON.parse(raw);
      switch (data.type) {
        case 'WEB_READY': await handleWebReady(); break;
        case 'WEB_ERROR': await handleWebError(data.payload); break;

        case 'CHECK_PERMISSION': await handleCheckPermission(); break;
        case 'REQUEST_PERMISSION': await handleRequestPermission(); break;

        case 'START_SUBSCRIPTION': await handleStartSubscription(data.payload); break;

        case 'START_SHARE': {
          try {
            const { image, caption, platform } = data.payload || {};
            await Share.open({
              title: '공유',
              message: caption ? `${caption}\n` : undefined,
              url: image,
            });
            sendToWeb('SHARE_RESULT', { success: true, platform, post_id: null });
          } catch (err) {
            sendToWeb('SHARE_RESULT', {
              success: false,
              platform: data?.payload?.platform,
              error_code: 'share_failed',
              message: String(err?.message || err),
            });
          }
          break;
        }

        case 'START_SIGNIN': await handleStartSignin(data.payload); break;
        case 'START_SIGNOUT': await handleStartSignout(); break;

        case 'EXIT_APP': BackHandler.exitApp(); break;

        case 'NAV_STATE': {
          const nav = data.payload || {};
          lastNavStateRef.current = {
            isRoot: !!nav.isRoot,
            path: nav.path ?? '',
            canGoBackInWeb: nav.canGoBackInWeb === true || nav.canGoBack === true,
            hasBlockingUI: !!nav.hasBlockingUI,
            needsConfirm: !!nav.needsConfirm,
          };
          sendToWeb('NAV_STATE_ACK', { nav: lastNavStateRef.current, at: Date.now() });
          break;
        }

        case 'BACK_PRESSED': {
          const nav = lastNavStateRef.current || {};
          console.log(TAG, 'BACK_PRESSED with nav=', nav);

          if (nav.isRoot === true) {
            Alert.alert(
              '앱 종료',
              '앱을 종료할까요?',
              [
                { text: '취소', style: 'cancel' },
                { text: '종료', style: 'destructive', onPress: () => BackHandler.exitApp() },
              ],
              { cancelable: true }
            );
          } else {
            sendToWeb('BACK_REQUEST', { nav, at: Date.now() });
          }
          break;
        }

        default: console.warn('⚠️ unknown msg:', data.type);
      }
    } catch (err) { console.error('❌ onMessage error:', err); }
  }, [handleCheckPermission, handleRequestPermission, handleStartSignin, handleStartSignout, handleWebError, handleWebReady, sendToWeb]);

  // ─────────── Splash / WebView ───────────
  const showSplashOnce = useCallback(() => {
    if (!splashVisible) {
      setSplashVisible(true);
      splashFade.setValue(1);
      splashStartRef.current = Date.now();
    } else if (!splashStartRef.current) {
      splashStartRef.current = Date.now();
    }
  }, [splashFade, splashVisible]);

  const hideSplashRespectingMin = useCallback(() => {
    const elapsed = Date.now() - (splashStartRef.current || Date.now());
    const wait = Math.max(MIN_SPLASH_MS - elapsed, 0);
    setTimeout(() => {
      Animated.timing(splashFade, {
        toValue: 0, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start(() => setSplashVisible(false));
    }, wait);
  }, [splashFade]);

  const onWebViewLoadStart = useCallback(() => {
    showSplashOnce();
    if (bootTORef.current) clearTimeout(bootTORef.current);
    bootTORef.current = setTimeout(() => {
      bootTORef.current = null;
      sendToWeb('OFFLINE_FALLBACK', { reason: 'timeout', at: Date.now() });
    }, BOOT_TIMEOUT_MS);
  }, [showSplashOnce, sendToWeb]);

  return (
    <SafeAreaView style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://wizad-b69ee.web.app' }}
        onMessage={onMessageFromWeb}
        onLoadStart={onWebViewLoadStart}
        onLoadProgress={({ nativeEvent }) => {
          if (nativeEvent.progress >= 0.9) hideSplashRespectingMin();
        }}
        onLoadEnd={() => { hideSplashRespectingMin(); }}
        javaScriptEnabled
        domStorageEnabled
        focusable
        overScrollMode="never"
        containerStyle={{ backgroundColor: 'transparent' }}
        style={{ backgroundColor: 'transparent' }}
      />
      {splashVisible && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: splashFade, backgroundColor: 'white' }]}>
          <SplashScreenRN />
        </Animated.View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});

export default App;
