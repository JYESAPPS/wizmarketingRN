package com.wizmarket

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "wizmarket"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    // ✅ 하드웨어 뒤로가기 오버라이드
  override fun onBackPressed() {
    try {
      // 현재 포커스를 가진 뷰 중 WebView인 경우만 처리
      val focusedView = currentFocus
      if (focusedView is WebView) {
        // JS로 BACK_PRESSED 메시지 전달
        focusedView.evaluateJavascript(
          """
            window.dispatchEvent(new MessageEvent('message', {
              data: JSON.stringify({ type: 'BACK_PRESSED' })
            }));
          """.trimIndent(),
          null
        )
        return // ✅ Web에게 맡겼으므로 기본 동작 안함
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }

    // ✅ WebView를 못 찾았으면 기본 동작 수행 (예: 백그라운드로 이동)
    super.onBackPressed()
  }
}
