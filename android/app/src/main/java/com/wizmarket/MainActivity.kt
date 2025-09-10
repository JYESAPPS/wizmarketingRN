package com.wizmarket

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsetsController
import androidx.core.content.ContextCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  companion object {
    private const val TAG = "BackTrace"
  }

  override fun getMainComponentName(): String = "wizmarket" // JS App 이름과 동일하게

  override fun createReactActivityDelegate(): ReactActivityDelegate =
          DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    // 스플래시 테마에서 AppTheme로 전환
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)

    // 상태바/네비게이션 바 흰색 강제
    val white = ContextCompat.getColor(this, android.R.color.white)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      window.statusBarColor = white
      window.navigationBarColor = white
    }

    // 아이콘 색상도 밝은 배경에 맞게 어둡게 설정
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.setSystemBarsAppearance(
              WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                      WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
              WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                      WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
      )
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility =
              (window.decorView.systemUiVisibility or
                      View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
                      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                              View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                      else 0))
    }
  }

  override fun onBackPressed() {
    super.onBackPressed() // RN BackHandler로 이벤트 전달
  }
}
