// android/app/src/main/java/com/wizmarket/MainApplication.kt
package com.wizmarket

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.wizmarket.kakao.KakaoLoginPackage

import com.kakao.sdk.common.KakaoSdk


class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
          object : DefaultReactNativeHost(this) {

            override fun getPackages(): List<ReactPackage> {
          val packages = PackageList(this).packages
          packages.add(KakaoLoginPackage())
          return packages
        }


            override fun getJSMainModuleName(): String = "index"
            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG
            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
          }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    KakaoSdk.init(this, BuildConfig.KAKAO_NATIVE_APP_KEY) // 키 주입 방식은 아래 참고

    loadReactNative(this)


  }
}
