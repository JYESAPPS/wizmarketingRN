// App.js — WizMarketing WebView Bridge
// (push + auth: Google live / Kakao native + SafeArea + Channel Share + Image Download→Gallery)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@react-native-firebase/app';
import {
  BackHandler, StyleSheet, Platform, Alert,
  Linking, LogBox, Animated, Easing, StatusBar,
  PermissionsAndroid,
} from 'react-native';
import { WebView } from 'react-native-webview';
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import Share from 'react-native-share';

import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';


import { CameraRoll } from '@react-native-camera-roll/camera-roll';

import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import SplashScreenRN from './SplashScreenRN';

import { NativeModules } from 'react-native';
const { KakaoLoginModule } = NativeModules;

const APP_VERSION = '1.0.0';
const BOOT_TIMEOUT_MS = 8000;
const MIN_SPLASH_MS = 1200;
const TAG = '[WizApp]';

// ─────────── Google Sign-In 초기화 ───────────
GoogleSignin.configure({
  webClientId: '266866879152-kfquq1i6r89tbqeramjjuaa2csmoegej.apps.googleusercontent.com',
  offlineAccess: true,
});

// ─────────── 공유 유틸/매핑 ───────────
const SOCIAL = Share.Social;
const SOCIAL_MAP = {
  INSTAGRAM: SOCIAL.INSTAGRAM,
  INSTAGRAM_STORIES: SOCIAL.INSTAGRAM_STORIES,
  FACEBOOK: SOCIAL.FACEBOOK,
  TWITTER: SOCIAL.TWITTER,
  SMS: SOCIAL.SMS,
  KAKAO: 'KAKAO',
  NAVER: 'NAVER',
  SYSTEM: 'SYSTEM',
};

function buildFinalText({ caption, hashtags = [], couponEnabled = false, link } = {}) {
  const tags = Array.isArray(hashtags) ? hashtags.join(' ') : (hashtags || '');
  return `${caption || ''}${tags ? `\n\n${tags}` : ''}${couponEnabled ? `\n\n✅ 민생회복소비쿠폰` : ''}${link ? `\n${link}` : ''}`.trim();
}

// RNFS 유틸
function downloadTo(fromUrl, toFile) {
  return RNFS.downloadFile({ fromUrl, toFile }).promise;
}
function guessExt(u = '') {
  u = u.toLowerCase();
  if (u.includes('.png')) return 'png';
  if (u.includes('.webp')) return 'webp';
  if (u.includes('.gif')) return 'gif';
  return 'jpg';
}
function extToMime(e) {
  return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg';
}

// ─────────── 이미지 저장: 권한 + 다운로드 + 갤러리 저장 ───────────
async function ensureMediaPermissions() {
  if (Platform.OS !== 'android') return;
  if (Platform.Version >= 33) {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
    );
    if (res !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('READ_MEDIA_IMAGES denied');
    }
  } else {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
    );
    if (res !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('WRITE_EXTERNAL_STORAGE denied');
    }
  }
}

async function downloadAndSaveToGallery(url, filename = 'image.jpg') {
  if (!url) throw new Error('no_url');
  await ensureMediaPermissions();

  const ext = (url.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const name = filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
  const dest = `${RNFS.CachesDirectoryPath}/${Date.now()}_${name}`;

  const { statusCode } = await RNFS.downloadFile({ fromUrl: url, toFile: dest }).promise;
  if (!(statusCode >= 200 && statusCode < 300)) {
    throw new Error(`download failed: ${statusCode}`);
  }
  await CameraRoll.save(dest, { type: 'photo' });
  RNFS.unlink(dest).catch(() => { });
}

// ─────────── 공유 핸들러 (카카오 포함) ───────────
function safeStr(x) {
  if (typeof x === 'string') return x;
  if (x == null) return '';
  try { return String(x); } catch { return ''; }
}
function stripImageUrlsFromText(text) {
  const s = safeStr(text);
  const out = s.replace(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi, '');
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

async function handleShareToChannel(payload, sendToWeb) {
  const key = (payload?.social || '').toUpperCase();
  const data = payload?.data || {};
  const social = SOCIAL_MAP[key] ?? SOCIAL_MAP.SYSTEM;

  const text = buildFinalText(data);
  let file = data.imageUrl || data.url || data.image;

  try {
    const needClipboard = [Share.Social.INSTAGRAM, Share.Social.INSTAGRAM_STORIES, Share.Social.FACEBOOK].includes(social);
    if (needClipboard && text) {
      Clipboard.setString(text);
      sendToWeb('TOAST', { message: '캡션이 복사되었어요. 업로드 화면에서 붙여넣기 하세요.' });
    }

    const ext = guessExt(file);
    const mime = extToMime(ext);

    // Kakao: file:// 로 공유
    if (key === 'KAKAO') {
      const src = data.imageUrl || data.url || data.image;
      const cleanText = safeStr(text);
      const pasteText = stripImageUrlsFromText(cleanText);

      const kExt = guessExt(src);
      const dlPath = `${RNFS.CachesDirectoryPath}/share_${Date.now()}.${kExt}`;
      const r = await RNFS.downloadFile({ fromUrl: src, toFile: dlPath }).promise;
      if (!(r && r.statusCode >= 200 && r.statusCode < 300)) {
        throw new Error(`download ${r?.statusCode || 'fail'}`);
      }
      const st = await RNFS.stat(dlPath);
      if (!st.isFile() || Number(st.size) <= 0) throw new Error('downloaded-file-empty');

      const fileUrl = `file://${dlPath}`;
      const kMime = extToMime(kExt);

      await Share.open({
        title: '카카오톡으로 공유',
        url: fileUrl,
        type: kMime,
        filename: `share.${kExt}`,
        message: pasteText,
        failOnCancel: false,
      });

      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }

    if (social === Share.Social.INSTAGRAM_STORIES) {
      await Share.shareSingle({
        social,
        backgroundImage: file,
        attributionURL: data.link,
        failOnCancel: false,
      });
      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }

    if (typeof social === 'string' && !['SYSTEM', 'KAKAO', 'NAVER'].includes(social)) {
      await Share.shareSingle({
        social,
        url: file,
        message: needClipboard ? undefined : text,
        type: mime,
        filename: `share.${ext}`,
        failOnCancel: false,
      });
      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }

    await Share.open({ url: file, message: text, title: '공유', type: mime, filename: `share.${ext}`, failOnCancel: false });
    sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
  } catch (err) {
    sendToWeb('SHARE_RESULT', { success: false, platform: key, error_code: 'share_failed', message: String(err?.message || err) });
  }
}

// ─────────── App 컴포넌트 ───────────
const App = () => {
  const webViewRef = useRef(null);




  const [splashVisible, setSplashVisible] = useState(true);
  const splashStartRef = useRef(0);
  const splashFade = useRef(new Animated.Value(1)).current;

  const bootTORef = useRef(null);
  const [token, setToken] = useState('');
  const lastPushTokenRef = useRef('');
  const lastNavStateRef = useRef({});

  useEffect(() => { LogBox.ignoreAllLogs(true); }, []);

  const sendToWeb = useCallback((type, payload = {}) => {
    try {
      const msg = JSON.stringify({ type, payload });
      webViewRef.current?.postMessage(msg);
    } catch (e) { console.log('❌ postMessage error:', e); }
  }, []);

  // Splash
  const hideSplashRespectingMin = useCallback(() => {
    const elapsed = Date.now() - (splashStartRef.current || Date.now());
    const wait = Math.max(MIN_SPLASH_MS - elapsed, 0);
    setTimeout(() => {
      Animated.timing(splashFade, {
        toValue: 0, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start(() => setSplashVisible(false));
    }, wait);
  }, [splashFade]);

  const showSplashOnce = useCallback(() => {
    if (!splashVisible) {
      setSplashVisible(true);
      splashFade.setValue(1);
      splashStartRef.current = Date.now();
    } else if (!splashStartRef.current) {
      splashStartRef.current = Date.now();
    }
  }, [splashFade, splashVisible]);

  // HW Back
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const nav = lastNavStateRef.current || {};
      const isRoot = nav.isRoot === true;
      const webCanHandle =
        !isRoot || nav.hasBlockingUI === true || nav.needsConfirm === true || nav.canGoBackInWeb === true;

      if (webCanHandle) {
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

  // Web ready/error
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

  // Push permission (notifee)
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

  // Push: token + foreground
  useEffect(() => {
    (async () => {
      try {
        const fcmToken = await messaging().getToken();
        setToken(fcmToken);
        lastPushTokenRef.current = fcmToken;

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

  // Auth: Google/Kakao
  const safeSend = (type, payload) => {
    try { sendToWeb(type, payload); } catch (e) { console.log('[SEND_ERROR]', e); }
  };

  const handleStartSignin = useCallback(async (payload) => {
    const provider = payload?.provider;
    try {
      if (provider === 'google') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        try { await GoogleSignin.signOut(); } catch { }
        try { await GoogleSignin.revokeAccess(); } catch { }
        const res = await GoogleSignin.signIn();
        let idToken = res?.idToken;
        if (!idToken) {
          try { const tokens = await GoogleSignin.getTokens(); idToken = tokens?.idToken || null; } catch { }
        }
        if (!idToken) throw new Error('no_id_token');
        const googleCredential = auth.GoogleAuthProvider.credential(idToken);
        const userCred = await auth().signInWithCredential(googleCredential);
        safeSend('SIGNIN_RESULT', {
          success: true,
          provider: 'google',
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

      if (provider === 'kakao') {
        try {
          const keyHash = await KakaoLoginModule.getKeyHash();
          console.log('[KAKAO] keyHash =', keyHash);
          const res = await KakaoLoginModule.login(); // {accessToken, refreshToken, id, email, nickname, photoURL}
          safeSend('SIGNIN_RESULT', {
            success: true,
            provider: 'kakao',
            user: {
              provider_id: String(res.id),
              email: res.email || '',
              displayName: res.nickname || '',
              photoURL: res.photoURL || '',
            },
            tokens: {
              access_token: res.accessToken,
              refresh_token: res.refreshToken || '',
            },
            expires_at: Date.now() + 6 * 3600 * 1000,
          });
          return;
        } catch (err) {
          console.log('[KAKAO LOGIN ERROR]', err);
          safeSend('SIGNIN_RESULT', {
            success: false,
            provider: 'kakao',
            error_code: err?.code || 'kakao_error',
            error_message: err?.message || String(err),
          });
          return;
        }
      }

      throw new Error('unsupported_provider');
    } catch (err) {
      const code =
        (err && typeof err === 'object' && 'code' in err) ? err.code :
          (String(err?.message || '').includes('no_id_token') ? 'no_id_token' : 'unknown_error');
      const msg =
        (err && typeof err === 'object' && 'message' in err && err.message) ||
        (typeof err === 'string' ? err : JSON.stringify(err));
      safeSend('SIGNIN_RESULT', { success: false, provider, error_code: code, error_message: msg });
    }
  }, [sendToWeb]);

  const handleStartSignout = useCallback(async () => {
    try {
      await auth().signOut();
      sendToWeb('SIGNOUT_RESULT', { success: true });
    } catch (err) {
      sendToWeb('SIGNOUT_RESULT', { success: false, error_code: 'signout_error', message: String(err?.message || err) });
    }
  }, [sendToWeb]);

  // Web → App 라우터
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

        case 'START_SUBSCRIPTION': {
          sendToWeb('SUBSCRIPTION_RESULT', {
            success: true,
            product_id: data?.payload?.product_id,
            transaction_id: 'tx_demo_001',
            expires_at: data?.payload?.product_type === 'subscription' ? Date.now() + 30 * 24 * 3600_000 : undefined,
          });
          break;
        }

        case 'START_SHARE': {
          try {
            const { image, caption, platform } = data.payload || {};
            await Share.open({
              title: '공유',
              message: caption ? `${caption}\n` : undefined,
              url: image,
              failOnCancel: false,
            });
            sendToWeb('SHARE_RESULT', { success: true, platform, post_id: null });
          } catch (err) {
            sendToWeb('SHARE_RESULT', { success: false, platform: data?.payload?.platform, error_code: 'share_failed', message: String(err?.message || err) });
          }
          break;
        }

        case 'share.toChannel': {
          await handleShareToChannel(data, sendToWeb);
          break;
        }

        case 'DOWNLOAD_IMAGE': {
          try {
            const { url, filename } = data.payload || {};
            if (!url) throw new Error('no_url');

            // 확장자 기본값 강제
            const safeName = filename && filename.includes('.') ? filename : 'image.jpg';

            await downloadAndSaveToGallery(url, safeName);
            sendToWeb('DOWNLOAD_RESULT', { success: true, filename: safeName });
            Alert.alert('완료', '이미지가 갤러리에 저장되었습니다.');
          } catch (err) {
            console.log('[DOWNLOAD_IMAGE][error]', err); // 🔍 에러 로그 확인
            sendToWeb('DOWNLOAD_RESULT', {
              success: false,
              error_code: 'save_failed',
              message: String(err?.message || err),
            });
            Alert.alert('오류', `이미지 저장 실패: ${String(err?.message || err)}`);
          }
          break;
        }

        case 'GET_PUSH_TOKEN': {
          try {
            const t = lastPushTokenRef.current || token || '';
            sendToWeb('PUSH_TOKEN', {
              token: t,
              platform: Platform.OS,
              app_version: APP_VERSION,
              install_id: 'unknown',
              ts: Date.now(),
            });
          } catch (err) {
            sendToWeb('PUSH_TOKEN', {
              token: '',
              platform: Platform.OS,
              app_version: APP_VERSION,
              install_id: 'unknown',
              ts: Date.now(),
              error: String(err?.message || err),
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

        default: console.log('⚠️ unknown msg:', data.type);
      }
    } catch (err) {
      console.error('❌ onMessage error:', err);
    }
  }, [handleCheckPermission, handleRequestPermission, handleStartSignin, handleStartSignout, handleWebError, handleWebReady, sendToWeb, token]);

  // WebView load
  const onWebViewLoadStart = useCallback(() => {
    showSplashOnce();
    if (bootTORef.current) clearTimeout(bootTORef.current);
    bootTORef.current = setTimeout(() => {
      sendToWeb('OFFLINE_FALLBACK', { reason: 'timeout', at: Date.now() });
    }, BOOT_TIMEOUT_MS);
  }, [showSplashOnce, sendToWeb]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <WebView
          ref={webViewRef}
          source={{ uri: 'http://www.wizmarket.ai:53003/ads/login/MA010120220808570604' }}
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
          containerStyle={{ backgroundColor: 'transparent', flex: 1 }}
          style={{ backgroundColor: 'transparent', flex: 1 }}
        />
        {splashVisible && (
          <SafeAreaInsetOverlay opacity={splashFade}>
            <SplashScreenRN />
          </SafeAreaInsetOverlay>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

function SafeAreaInsetOverlay({ opacity, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity,
          backgroundColor: 'white',
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});

export default App;
