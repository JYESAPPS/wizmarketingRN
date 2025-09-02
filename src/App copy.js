// App.js — WizMarketing WebView Bridge (final, splash-only pre-load)
// deps: react-native-webview, @react-native-firebase/messaging,
//       @react-native-community/geolocation, @notifee/react-native, react-native-share

import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@react-native-firebase/app';               // ✅ 가장 먼저 로드
import {
  SafeAreaView,
  BackHandler,
  StyleSheet,
  Platform,
  PermissionsAndroid,
  Linking,
  LogBox,
  Animated,
  ToastAndroid,
  Easing,
} from 'react-native';
import { WebView } from 'react-native-webview';
import messaging from '@react-native-firebase/messaging';
import Geolocation from '@react-native-community/geolocation';
import notifee from '@notifee/react-native';
import Share from 'react-native-share';

import SplashScreenRN from './SplashScreenRN';

// ──────────────────────────────────────────────────────────────
// 상수/상태
// ──────────────────────────────────────────────────────────────
const APP_VERSION = '1.0.0';          // TODO: device-info 연동 시 실제 버전으로
const BOOT_TIMEOUT_MS = 8000;         // WEB_READY 타임아웃
const MIN_SPLASH_MS = 1200;           // 스플래시 최소 표시 시간

// ──────────────────────────────────────────────────────────────
// 컴포넌트
// ──────────────────────────────────────────────────────────────
const App = () => {
  const webViewRef = useRef(null);

  // 스플래시
  const [splashVisible, setSplashVisible] = useState(true);
  const splashStartRef = useRef(0);
  const splashFade = useRef(new Animated.Value(1)).current;

  // 부팅 타임아웃
  const bootTORef = useRef(null);

  // 네비/백
  const lastNavStateRef = useRef(null); // 마지막 NAV_STATE 저장
  const backExitRef = useRef({ last: 0 }); // 루트 더블탭 종료 시각

  // 푸시 토큰
  const [token, setToken] = useState('');

  useEffect(() => { LogBox.ignoreAllLogs(true); }, []);

  // ──────────────────────────────────────────────────────────
  // 공통 전송 헬퍼: { type, payload } 포맷으로 통일
  // ──────────────────────────────────────────────────────────
  const sendToWeb = useCallback((type, payload = {}) => {
    try {
      const msg = JSON.stringify({ type, payload });
      webViewRef.current?.postMessage(msg);
      if (__DEV__) console.log('📡 to Web:', msg);
    } catch (e) {
      console.log('❌ postMessage error:', e);
    }
  }, []);

  // ──────────────────────────────────────────────────────────
  // 스플래시 표시/해제
  // ──────────────────────────────────────────────────────────
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
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => setSplashVisible(false));
    }, wait);
  }, [splashFade]);

  // ──────────────────────────────────────────────────────────
  // 퍼미션 유틸
  // ──────────────────────────────────────────────────────────
  const ensureLocationPermission = useCallback(async () => {
    try {
      if (Platform.OS === 'android') {
        const perm = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
        const has = await PermissionsAndroid.check(perm);
        if (has) return true;
        const res = await PermissionsAndroid.request(perm);
        return res === PermissionsAndroid.RESULTS.GRANTED;
      }
      // iOS는 Info.plist 키만 있으면 런타임 요청 없이 동작(요청은 첫 사용 시 시스템 팝업)
      return true;
    } catch {
      return false;
    }
  }, []);

  const ensureNotificationPermission = useCallback(async () => {
    try {
      const settings = await notifee.requestPermission();
      return !!settings?.authorizationStatus;
    } catch {
      return false;
    }
  }, []);

  // ──────────────────────────────────────────────────────────
  // 권한 상태 회신
  // ──────────────────────────────────────────────────────────
  const replyPermissionStatus = useCallback(({ locationGranted, pushGranted, pos }) => {
    sendToWeb('PERMISSION_STATUS', {
      camera: { granted: !!locationGranted, blocked: false }, // (데모) 위치를 카메라 슬롯에 매핑
      push:   { granted: !!pushGranted,     blocked: false },
      latitude:  pos?.coords?.latitude,
      longitude: pos?.coords?.longitude,
      token,
    });
  }, [sendToWeb, token]);

  // ──────────────────────────────────────────────────────────
  // 케이스별 핸들러
  // ──────────────────────────────────────────────────────────
  // 1) 부팅/스플래시: WEB_READY / WEB_ERROR
  const handleWebReady = useCallback(async (payload) => {
    if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
    sendToWeb('WEB_READY_ACK', { at: Date.now() });
    hideSplashRespectingMin();
  }, [hideSplashRespectingMin, sendToWeb]);

  const handleWebError = useCallback(async (payload) => {
    if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
    sendToWeb('WEB_ERROR_ACK', { ...payload, at: Date.now() });
    sendToWeb('OFFLINE_FALLBACK', { reason: 'js_error', at: Date.now() });
    // 스플래시는 그대로 폴백 오버레이 역할을 수행
  }, [sendToWeb]);

  // 2) 뒤로가기: NAV_STATE → 저장 / BACK_REQUEST는 하드웨어에서 패스스루
  const handleNavState = useCallback(async (payload) => {
    lastNavStateRef.current = payload || {};
  }, []);

  // 3) 권한: CHECK_PERMISSION / REQUEST_PERMISSION → PERMISSION_STATUS 회신
  const handleCheckPermission = useCallback(async () => {
    const locationGranted = await ensureLocationPermission();
    const pushGranted     = await ensureNotificationPermission();

    if (locationGranted) {
      Geolocation.getCurrentPosition(
        (pos) => replyPermissionStatus({ locationGranted, pushGranted, pos }),
        ()    => replyPermissionStatus({ locationGranted: false, pushGranted }),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
      );
    } else {
      replyPermissionStatus({ locationGranted, pushGranted });
    }
  }, [ensureLocationPermission, ensureNotificationPermission, replyPermissionStatus]);

  const handleRequestPermission = useCallback(async () => {
    const locationGranted = await ensureLocationPermission();
    const pushGranted     = await ensureNotificationPermission();

    if (locationGranted) {
      Geolocation.getCurrentPosition(
        (pos) => replyPermissionStatus({ locationGranted, pushGranted, pos }),
        ()    => replyPermissionStatus({ locationGranted: false, pushGranted }),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
      );
    } else {
      replyPermissionStatus({ locationGranted, pushGranted });
    }
  }, [ensureLocationPermission, ensureNotificationPermission, replyPermissionStatus]);

  // 4) 푸시: 앱 주도. 포그라운드 수신 시 PUSH_EVENT 전달
  const sendPushTokenOnce = useCallback(async () => {
    try {
      const fcmToken = await messaging().getToken();
      setToken(fcmToken);
      sendToWeb('PUSH_TOKEN', {
        token: fcmToken,
        platform: Platform.OS,
        app_version: APP_VERSION,
        install_id: 'unknown', // TODO: device-uuid 연동
        ts: Date.now(),
      });
    } catch (e) {
      console.log('❌ FCM 토큰 에러:', e);
    }
  }, [sendToWeb]);

  // 5) 로그인: START_SIGNIN / START_SIGNOUT → RESULT (스텁)
  const handleStartSignin = useCallback(async (payload) => {
    const { provider } = payload || {};
    // TODO: 카카오/구글/애플 SDK 연동
    sendToWeb('SIGNIN_RESULT', {
      success: true,
      provider,
      user: { id: 'u_123', nickname: '홍여사' },
      access_token: 'access-demo',
      id_token: 'id-demo',
      refresh_token: 'refresh-demo',
      expires_at: Date.now() + 3600_000,
      scopes: ['profile'],
    });
  }, [sendToWeb]);

  const handleStartSignout = useCallback(async () => {
    // TODO: SDK 로그아웃
    sendToWeb('SIGNOUT_RESULT', { success: true });
  }, [sendToWeb]);

  // 6) 결제: START_SUBSCRIPTION → SUBSCRIPTION_RESULT (스텁)
  const handleStartSubscription = useCallback(async (payload) => {
    // TODO: react-native-iap 연동
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

  // 7) 공유: START_SHARE → SHARE_RESULT
  const handleStartShare = useCallback(async (payload) => {
    try {
      const { image, caption, platform } = payload || {};
      await Share.open({
        title: '공유',
        message: caption ? `${caption}
` : undefined,
        url: image, // file:/// or https://
      });
      sendToWeb('SHARE_RESULT', { success: true, platform, post_id: null });
    } catch (err) {
      sendToWeb('SHARE_RESULT', {
        success: false,
        platform: payload?.platform,
        error_code: 'share_failed',
        message: String(err?.message || err),
      });
    }
  }, [sendToWeb]);

  // ──────────────────────────────────────────────────────────
  // 메시지 라우터 (Web → App 수신)
  // ──────────────────────────────────────────────────────────
  const onMessageFromWeb = useCallback(async (e) => {
    try {
      const raw = e.nativeEvent.data;

      // 특수 커맨드 (옛날 호환)
      if (typeof raw === 'string' && raw.startsWith('open::')) {
        const url = raw.replace('open::', '');
        try { await Linking.openURL(url); } catch {}
        return;
      }

      const data = JSON.parse(raw);
      switch (data.type) {
        // 부팅/스플래시
        case 'WEB_READY':           await handleWebReady(data.payload); break;
        case 'WEB_ERROR':           await handleWebError(data.payload); break;

        // 네비/뒤로가기
        case 'NAV_STATE':           await handleNavState(data.payload); break;

        // 권한
        case 'CHECK_PERMISSION':    await handleCheckPermission(); break;
        case 'REQUEST_PERMISSION':  await handleRequestPermission(); break;

        // 로그인
        case 'START_SIGNIN':        await handleStartSignin(data.payload); break;
        case 'START_SIGNOUT':       await handleStartSignout(); break;

        // 결제
        case 'START_SUBSCRIPTION':  await handleStartSubscription(data.payload); break;

        // 공유
        case 'START_SHARE':         await handleStartShare(data.payload); break;

        // 기타 레거시
        case 'OPEN_SETTINGS':       Linking.openSettings?.(); break;
        case 'EXIT_APP':            BackHandler.exitApp(); break;

        default:
          console.warn('⚠️ 알 수 없는 메시지:', data.type);
      }
    } catch (err) {
      console.error('❌ Web 메시지 처리 오류:', err);
    }
  }, [handleCheckPermission, handleRequestPermission, handleStartShare, handleStartSignin, handleStartSignout, handleStartSubscription, handleNavState, handleWebError, handleWebReady]);

  // ──────────────────────────────────────────────────────────
  // 하드웨어 뒤로가기: NAV_STATE 기반 패스스루 / 루트 더블탭 종료
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const nav = lastNavStateRef.current || {};
      if (nav.isRoot) {
        const now = Date.now();
        if (now - backExitRef.current.last < 1200) {
          BackHandler.exitApp();
        } else {
          backExitRef.current.last = now;
          if (Platform.OS === 'android') {
            ToastAndroid.show('한 번 더 누르면 종료됩니다', ToastAndroid.SHORT);
          }
        }
        return true; // 소비
      }
      // 루트가 아니면 BACK_REQUEST 패스스루
      sendToWeb('BACK_REQUEST', { nav });
      return true;
    });
    return () => sub.remove();
  }, [sendToWeb]);

  // ──────────────────────────────────────────────────────────
  // 초기화(FCM 토큰 전송, 포그라운드 알림 브리지)
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    // FCM 토큰 전송 (앱 시작 시)
    sendPushTokenOnce();

    // 포그라운드 알림을 PUSH_EVENT(received)로 브리지
    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      sendToWeb('PUSH_EVENT', {
        event: 'received',
        title: remoteMessage.notification?.title,
        body:  remoteMessage.notification?.body,
        deeplink: remoteMessage.data?.deeplink,
        messageId: remoteMessage.messageId,
        ts: Date.now(),
      });
    });

    return () => unsubscribe();
  }, [sendPushTokenOnce, sendToWeb]);

  // ──────────────────────────────────────────────────────────
  // WebView 로딩 훅: 부팅 타임아웃, 스플래시, 앱/배경 투명화
  // ──────────────────────────────────────────────────────────
  const onWebViewLoadStart = useCallback(() => {
    showSplashOnce();
    if (bootTORef.current) clearTimeout(bootTORef.current);
    bootTORef.current = setTimeout(() => {
      bootTORef.current = null;
      sendToWeb('OFFLINE_FALLBACK', { reason: 'timeout', at: Date.now() });
    }, BOOT_TIMEOUT_MS);
  }, [showSplashOnce, sendToWeb]);

  const sendAppInfo = useCallback(() => {
    sendToWeb('APP_INFO', {
      platform: Platform.OS,
      os_version: Platform.Version,
      app_version: APP_VERSION,
    });
  }, [sendToWeb]);

  // ──────────────────────────────────────────────────────────
  // 렌더
  // ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://wizmarketing-d024d.web.app' }}
        onMessage={onMessageFromWeb}
        onLoadStart={onWebViewLoadStart}
        onLoadProgress={({ nativeEvent }) => {
          if (nativeEvent.progress >= 0.9) hideSplashRespectingMin();
        }}
        onLoadEnd={() => { hideSplashRespectingMin(); sendAppInfo(); }}
        javaScriptEnabled
        domStorageEnabled
        overScrollMode="never"                                   // 안드 스크롤 글로우 제거
        containerStyle={{ backgroundColor: 'transparent' }}       // 컨테이너 투명
        style={{ backgroundColor: 'transparent' }}                // WebView 뷰 투명
        injectedJavaScriptBeforeContentLoaded={`
          (function(){
            try {
              document.documentElement.style.backgroundColor = 'transparent';
              document.body.style.backgroundColor = 'transparent';
              var css = 'html,body{background:transparent!important;overflow:auto;-webkit-font-smoothing:antialiased;}::-webkit-scrollbar{display:none;}';
              var s = document.createElement('style'); s.innerHTML = css; document.head.appendChild(s);
            } catch (e) {}
          })();
          true;
        `}
      />

      {splashVisible && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: splashFade, backgroundColor: 'white' }]}>
          <SplashScreenRN />
        </Animated.View>
      )}
    </SafeAreaView>
  );
};

// ──────────────────────────────────────────────────────────
// 스타일
// ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});

export default App;
