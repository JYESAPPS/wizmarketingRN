// SplashScreenRN.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing } from 'react-native';

export default function SplashScreenRN({
  onDone,
  minDuration = 2000,        // 형 요구대로 기본 2초
  brandBg = '#FF7E19',
  brandText = '#ffffff',
  primary = '#ffffff',
  logoSource,                 // 예: require('./assets/logo.png')
  brandName = 'Wiz Market',
}) {
  const [visible, setVisible] = useState(true);
  const fade = useRef(new Animated.Value(0)).current;

  // dots: opacity & translateY
  const dots = useMemo(
    () => [0, 1, 2].map(() => ({
      o: new Animated.Value(0.3),
      y: new Animated.Value(0),
    })),
    []
  );

  useEffect(() => {
    const start = Date.now();

    // fade-in
    Animated.timing(fade, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // dots pulse loop
    dots.forEach((d, i) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(d.o, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(d.y, { toValue: -3, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(d.o, { toValue: 0.3, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(d.y, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ])
      );
      setTimeout(() => loop.start(), i * 150); // 0ms, 150ms, 300ms 지연
    });

    // 최소 표시시간 보장 후 onDone
    const finish = () => {
      const elapsed = Date.now() - start;
      const remain = Math.max(0, minDuration - elapsed);
      setTimeout(() => {
        // fade-out
        Animated.timing(fade, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start(() => {
          setVisible(false);
          onDone?.();
        });
      }, remain);
    };

    // RN에선 window load 개념이 없으니, 외부에서 onDone을 호출하지 않는 경우
    // 화면 마운트 시점 기준으로 minDuration 뒤에 닫히게만 동작.
    // → WebView 로딩 이벤트와 연동하려면 부모(App.js)에서 onDone 트리거해도 됨.
    // 여기서는 "최소 시간 보장 후 닫기" 기본 동작만.
    finish();

    // cleanup 불필요(Animated.loop 내부가 계속 도니 unmount 시 자동 정리)
  }, [minDuration]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.wrap, { backgroundColor: brandBg, opacity: fade }]} accessible accessibilityRole="alert">
      {logoSource ? <Image source={logoSource} style={styles.logo} resizeMode="contain" /> : null}
      <Text style={[styles.brand, { color: brandText }]}>{brandName}</Text>
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no">
        {dots.map((d, idx) => (
          <Animated.View
            key={idx}
            style={[
              styles.dot,
              { backgroundColor: primary, opacity: d.o, transform: [{ translateY: d.y }] },
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    inset: 0,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 20,
  },
  brand: {
    fontWeight: '900',
    letterSpacing: -0.5,
    fontSize: 20,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
