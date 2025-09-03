package com.wizmarket

import android.util.Log
import android.webkit.WebView
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  companion object {
    private const val TAG = "BackTrace"
  }


  override fun getMainComponentName(): String = "wizmarket"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // 하드웨어 뒤로가기 → 포커스가 WebView면 JS로 BACK_PRESSED 먼저 전달
  // override fun onBackPressed() {
  //   try {
  //     // 현재 포커스를 가진 뷰 중 WebView인 경우만 처리
  //     val focusedView = currentFocus

  //     Log.d(TAG, "onBackPressed() focused=${focusedView?.javaClass?.name}");

  //     if (focusedView is WebView) {
  //       // JS로 BACK_PRESSED 메시지 전달
  //       focusedView.evaluateJavascript(
  //         """
  //           window.dispatchEvent(new MessageEvent('message', {
  //             data: JSON.stringify({ type: 'BACK_PRESSED' })
  //           }));
  //         """.trimIndent(),
  //         null
  //       )
  //       Log.d(TAG, "onBackPressed(): return (prevent default)")
  //       return // ✅ Web에게 맡겼으므로 기본 동작 안함
  //     }
  //   } catch (e: Exception) {
  //     e.printStackTrace()
  //   }


  //   // ✅ WebView를 못 찾았으면 기본 동작 수행 (예: 백그라운드로 이동)
  //   Log.d(TAG, "onBackPressed(): not WebView → super")
  //   super.onBackPressed()
  // }

  override fun onBackPressed() {
    super.onBackPressed()  // RN BackHandler로 이벤트 전달
  }
}
