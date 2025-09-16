package com.wizmarket.kakao

import android.app.Activity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.kakao.sdk.auth.model.OAuthToken
import com.kakao.sdk.common.util.Utility
import com.kakao.sdk.user.UserApiClient
import com.kakao.sdk.user.model.User

class KakaoLoginModule(private val reactCtx: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactCtx) {

    override fun getName(): String = "KakaoLoginModule"

    // -----------------------
    // Helpers
    // -----------------------
    private fun toMap(token: OAuthToken, user: User?): WritableMap {
        val ka = user?.kakaoAccount
        val profile = ka?.profile
        return Arguments.createMap().apply {
            putString("accessToken", token.accessToken)
            putString("refreshToken", token.refreshToken ?: "")
            putString("id", user?.id?.toString() ?: "")
            putString("email", ka?.email ?: "")
            putString("nickname", profile?.nickname ?: "")
            putString("photoURL", profile?.thumbnailImageUrl ?: "")
        }
    }

    private fun resolveWithUserTokenOnly(token: OAuthToken, promise: Promise) {
        val map =
                Arguments.createMap().apply {
                    putString("accessToken", token.accessToken)
                    putString("refreshToken", token.refreshToken ?: "")
                    putString("id", "")
                    putString("email", "")
                    putString("nickname", "")
                    putString("photoURL", "")
                }
        promise.resolve(map)
    }

    /** me() → 동의 항목 확인 → 필요 시 loginWithNewScopes() → me() 재호출 → resolve */
    private fun fetchUserEnsuringScopes(activity: Activity, token: OAuthToken, promise: Promise) {
        UserApiClient.instance.me { user, err ->
            if (err != null) {
                // me() 실패해도 최소 토큰은 내려줌
                resolveWithUserTokenOnly(token, promise)
                return@me
            }
            if (user == null) {
                resolveWithUserTokenOnly(token, promise)
                return@me
            }

            val ka = user.kakaoAccount
            val missing = mutableListOf<String>()
            // 필요 스코프 수집 (콘솔에서 해당 동의 항목이 활성화되어 있어야 함)
            if (ka?.emailNeedsAgreement == true) missing.add("account_email")
            if (ka?.profileNeedsAgreement == true) {
                missing.add("profile_nickname")
                missing.add("profile_image")
            }

            if (missing.isEmpty()) {
                promise.resolve(toMap(token, user))
                return@me
            }

            // 추가 동의 요청 후 재조회
            UserApiClient.instance.loginWithNewScopes(activity, missing) { token2, err2 ->
                val finalToken = token2 ?: token
                if (err2 != null) {
                    // 추가 동의 실패해도 현재 정보로 반환
                    promise.resolve(toMap(finalToken, user))
                    return@loginWithNewScopes
                }
                UserApiClient.instance.me { user2, err3 ->
                    val u = user2 ?: user
                    promise.resolve(toMap(finalToken, u))
                }
            }
        }
    }

    // -----------------------
    // RN Methods
    // -----------------------

    /** 카카오톡 SSO 우선 → 실패 시 카카오 계정 로그인 폴백 토큰 수령 후 me()로 유저정보 조회 및 추가동의 처리 */
    @ReactMethod
    fun loginWithKakaoTalk(promise: Promise) {
        val activity: Activity =
                reactCtx.currentActivity
                        ?: run {
                            promise.reject("no_activity", "No current activity")
                            return
                        }

        // 1차: 카카오톡 앱 SSO (이미 로그인돼 있으면 창 없이 바로 성공할 수 있음)
        UserApiClient.instance.loginWithKakaoTalk(activity) { token, error ->
            if (error != null) {
                // 2차: 카카오 계정 로그인 폴백
                UserApiClient.instance.loginWithKakaoAccount(activity) { token2, error2 ->
                    if (error2 != null) {
                        promise.reject("kakao_login_failed", error2.message, error2)
                    } else if (token2 != null) {
                        fetchUserEnsuringScopes(activity, token2, promise)
                    } else {
                        promise.reject("kakao_login_failed", "token is null")
                    }
                }
            } else if (token != null) {
                fetchUserEnsuringScopes(activity, token, promise)
            } else {
                promise.reject("kakao_login_failed", "token is null")
            }
        }
    }

    /** 레거시 단일 진입점 */
    @ReactMethod
    fun login(promise: Promise) {
        loginWithKakaoTalk(promise)
    }

    /** (선택) JS에서 키해시 확인용 */
    @ReactMethod
    fun getKeyHash(promise: Promise) {
        try {
            val hash = Utility.getKeyHash(reactCtx)
            promise.resolve(hash)
        } catch (e: Exception) {
            promise.reject("keyhash_error", e.message, e)
        }
    }

    /** (선택) JS에서 설치 가능 여부 확인용 */
    @ReactMethod
    fun isKakaoTalkLoginAvailable(promise: Promise) {
        try {
            val available = UserApiClient.instance.isKakaoTalkLoginAvailable(reactCtx)
            promise.resolve(available)
        } catch (e: Exception) {
            promise.reject("kakao_available_error", e.message, e)
        }
    }
}
