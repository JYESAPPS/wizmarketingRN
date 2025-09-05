// App.js — WizMarketing WebView Bridge (push-only)
// deps: react-native-webview, @react-native-firebase/messaging, @notifee/react-native, react-native-share

import React, { useCallback, useEffect, useRef, useState } from "react";
import "@react-native-firebase/app";
import {
  SafeAreaView, BackHandler, StyleSheet, Platform, Alert,
  Linking, LogBox, Animated, Easing,
} from "react-native";
import { WebView } from "react-native-webview";
import messaging from "@react-native-firebase/messaging";
import notifee from "@notifee/react-native";
import Share from "react-native-share";

import SplashScreenRN from "./SplashScreenRN";

const TAG = "[WizMarketingApp]";
const APP_VERSION = "1.0.0";
const BOOT_TIMEOUT_MS = 8000;
const MIN_SPLASH_MS = 1200;
const WEB_URL = "https://wizad-b69ee.web.app";

const App = () => {
  const webViewRef = useRef(null);

  const [splashVisible, setSplashVisible] = useState(true);
  const splashStartRef = useRef(0);
  const splashFade = useRef(new Animated.Value(1)).current;

  const bootTORef = useRef(null);

  const [token, setToken] = useState("");
  const lastTokenRef = useRef(null);

  // 웹이 알려주는 네비 상태 (뒤로가기 정책 판단용)
  const lastNavStateRef = useRef({
    isRoot: false,
    path: "/",
    canGoBackInWeb: false,
    hasBlockingUI: false,
    needsConfirm: false,
  });

  useEffect(() => { LogBox.ignoreAllLogs(true); }, []);

  /** WebView로 메시지 보내기 (RN → Web) */
  const sendToWeb = useCallback((type, payload = {}) => {
    try {
      const js = `
        (function(){
          var msg = ${JSON.stringify({ type, payload })};
          window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) }));
        })();
        true;
      `;
      webViewRef.current?.injectJavaScript(js);
      if (__DEV__) console.log("📡 to Web:", { type, payload });
    } catch (e) {
      console.log("❌ injectJS error:", e);
    }
  }, []);

  /** 스플래시 표시/해제 */
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

  /** Web ↔ App 브리지용 핸들러 */
  const handleWebReady = useCallback(() => {
    if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
    sendToWeb("WEB_READY_ACK", { at: Date.now() });
    // 웹 리스너가 붙은 시점에 마지막 토큰 재전송(드롭 방지)
    if (lastTokenRef.current) {
      sendToWeb("PUSH_TOKEN", {
        token: lastTokenRef.current,
        platform: Platform.OS,
        app_version: APP_VERSION,
        install_id: "unknown",
        ts: Date.now(),
      });
    }
    hideSplashRespectingMin();
  }, [hideSplashRespectingMin, sendToWeb]);

  const handleWebError = useCallback((payload) => {
    if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
    sendToWeb("WEB_ERROR_ACK", { ...(payload || {}), at: Date.now() });
    sendToWeb("OFFLINE_FALLBACK", { reason: payload?.reason || "js_error", at: Date.now() });
    // 스플래시는 폴백 오버레이 역할로 유지
  }, [sendToWeb]);

  /** 알림 권한 요청/응답 */
  const ensureNotificationPermission = useCallback(async () => {
    try {
      const settings = await notifee.requestPermission();
      return !!settings?.authorizationStatus;
    } catch {
      return false;
    }
  }, []);

  const replyPermissionStatus = useCallback(({ pushGranted }) => {
    sendToWeb("PERMISSION_STATUS", {
      push: { granted: !!pushGranted, blocked: false },
      token,
    });
  }, [sendToWeb, token]);

  /** 구독(샘플) */
  const handleStartSubscription = useCallback(async (payload) => {
    sendToWeb("SUBSCRIPTION_RESULT", {
      success: true,
      product_id: payload?.product_id,
      transaction_id: "tx_demo_001",
      expires_at: payload?.product_type === "subscription" ? Date.now() + 30 * 24 * 3600_000 : undefined,
    });
  }, [sendToWeb]);

  /** 첫 실행 권한 보고 */
  useEffect(() => {
    (async () => {
      const push = await ensureNotificationPermission();
      replyPermissionStatus({ pushGranted: push });
    })();
  }, [ensureNotificationPermission, replyPermissionStatus]);

  /** HW Back → 웹에 BACK_REQUEST or 종료 확인 */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const nav = lastNavStateRef.current || {};
      const isRoot = nav.isRoot === true;
      const webCanHandle =
        !isRoot || nav.hasBlockingUI === true || nav.needsConfirm === true || nav.canGoBackInWeb === true;

      if (webCanHandle) {
        sendToWeb("BACK_REQUEST", { nav, at: Date.now() });
        return true;
      }
      // 루트면 종료 확인
      Alert.alert("앱 종료", "앱을 종료할까요?", [
        { text: "취소", style: "cancel" },
        { text: "종료", style: "destructive", onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    });
    return () => sub.remove();
  }, [sendToWeb]);

  /** FCM 토큰 & 이벤트 브리지 */
  useEffect(() => {
    (async () => {
      try {
        const fcmToken = await messaging().getToken();
        setToken(fcmToken);
        lastTokenRef.current = fcmToken;
        // 초기 토큰 전달 (웹이 아직 준비 전일 수 있으므로 WEB_READY때 재전송도 함)
        sendToWeb("PUSH_TOKEN", {
          token: fcmToken,
          platform: Platform.OS,
          app_version: APP_VERSION,
          install_id: "unknown",
          ts: Date.now(),
        });
      } catch (e) {
        console.log("❌ FCM token error:", e);
      }
    })();

    // 포그라운드 알림
    const fg = messaging().onMessage(async (remoteMessage) => {
      sendToWeb("PUSH_EVENT", {
        event: "received",
        title: remoteMessage.notification?.title,
        body: remoteMessage.notification?.body,
        deeplink: remoteMessage.data?.deeplink,
        extra: remoteMessage.data || null,
        platform: Platform.OS,
        messageId: remoteMessage.messageId,
        ts: Date.now(),
      });
    });

    // 백그라운드/리줌 클릭
    const opened = messaging().onNotificationOpenedApp((remoteMessage) => {
      sendToWeb("PUSH_EVENT", {
        event: "clicked",
        title: remoteMessage.notification?.title,
        body: remoteMessage.notification?.body,
        deeplink: remoteMessage.data?.deeplink,
        extra: remoteMessage.data || null,
        platform: Platform.OS,
        messageId: remoteMessage.messageId,
        ts: Date.now(),
      });
    });

    // 냉시작 클릭
    (async () => {
      const initial = await messaging().getInitialNotification();
      if (initial) {
        sendToWeb("PUSH_EVENT", {
          event: "clicked",
          title: initial.notification?.title,
          body: initial.notification?.body,
          deeplink: initial.data?.deeplink,
          extra: initial.data || null,
          platform: Platform.OS,
          messageId: initial.messageId,
          ts: Date.now(),
        });
      }
    })();

    return () => { fg(); opened(); };
  }, [sendToWeb]);

  /** Web → App 라우터 */
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
      // 아주 단순한 명령형 프로토콜 (예: open::<url>)
      if (typeof raw === "string" && raw.startsWith("open::")) {
        const url = raw.replace("open::", "");
        try { await Linking.openURL(url); } catch {}
        return;
      }
      const data = JSON.parse(raw);
      switch (data.type) {
        case "WEB_READY":         await handleWebReady(); break;
        case "WEB_ERROR":         await handleWebError(data.payload); break;

        case "CHECK_PERMISSION":  await handleCheckPermission(); break;
        case "REQUEST_PERMISSION":await handleRequestPermission(); break;

        case "START_SUBSCRIPTION":await handleStartSubscription(data.payload); break;

        case "START_SHARE": {
          try {
            const { image, caption, platform } = data.payload || {};
            await Share.open({
              title: "공유",
              message: caption ? `${caption}\n` : undefined,
              url: image,
            });
            sendToWeb("SHARE_RESULT", { success: true, platform, post_id: null });
          } catch (err) {
            sendToWeb("SHARE_RESULT", {
              success: false,
              platform: data?.payload?.platform,
              error_code: "share_failed",
              message: String(err?.message || err),
            });
          }
          break;
        }

        case "EXIT_APP": BackHandler.exitApp(); break;

        case "NAV_STATE": {
          const nav = data.payload || {};
          lastNavStateRef.current = {
            isRoot: !!nav.isRoot,
            path: nav.path ?? "",
            canGoBackInWeb: nav.canGoBackInWeb === true || nav.canGoBack === true,
            hasBlockingUI: !!nav.hasBlockingUI,
            needsConfirm: !!nav.needsConfirm,
          };
          sendToWeb("NAV_STATE_ACK", { nav: lastNavStateRef.current, at: Date.now() });
          break;
        }

        case "BACK_PRESSED": {
          const nav = lastNavStateRef.current || {};
          if (nav.isRoot === true) {
            Alert.alert(
              "앱 종료",
              "앱을 종료할까요?",
              [
                { text: "취소", style: "cancel" },
                { text: "종료", style: "destructive", onPress: () => BackHandler.exitApp() },
              ],
              { cancelable: true }
            );
          } else {
            sendToWeb("BACK_REQUEST", { nav, at: Date.now() });
          }
          break;
        }

        default:
          console.warn("⚠️ unknown msg:", data.type);
      }
    } catch (err) {
      console.error("❌ onMessage error:", err);
    }
  }, [handleCheckPermission, handleRequestPermission, handleStartSubscription, handleWebError, handleWebReady, sendToWeb]);

  /** WebView 로딩 이벤트 */
  const onWebViewLoadStart = useCallback(() => {
    showSplashOnce();
    if (bootTORef.current) clearTimeout(bootTORef.current);
    bootTORef.current = setTimeout(() => {
      bootTORef.current = null;
      sendToWeb("OFFLINE_FALLBACK", { reason: "timeout", at: Date.now() });
    }, BOOT_TIMEOUT_MS);
  }, [showSplashOnce, sendToWeb]);

  return (
    <SafeAreaView style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: WEB_URL }}
        onMessage={onMessageFromWeb}
        onLoadStart={onWebViewLoadStart}
        onLoadProgress={({ nativeEvent }) => {
          if (nativeEvent.progress >= 0.9) hideSplashRespectingMin();
        }}
        onLoadEnd={() => { hideSplashRespectingMin(); }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        overScrollMode="never"
        containerStyle={{ backgroundColor: "transparent" }}
        style={{ backgroundColor: "transparent" }}
      />

      {splashVisible && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: splashFade, backgroundColor: "white" }]}>
          <SplashScreenRN />
        </Animated.View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
});

export default App;
