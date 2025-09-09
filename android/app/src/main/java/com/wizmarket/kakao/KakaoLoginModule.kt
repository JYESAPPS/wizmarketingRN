package com.wizmarket.kakao

import com.facebook.react.bridge.*
import com.kakao.sdk.auth.model.OAuthToken
import com.kakao.sdk.common.util.Utility
import com.kakao.sdk.user.UserApiClient

class KakaoLoginModule(private val rc: ReactApplicationContext) : ReactContextBaseJavaModule(rc) {

    override fun getName() = "KakaoLoginModule"

    @ReactMethod
    fun getKeyHash(promise: Promise) {
        try {
            val kh = Utility.getKeyHash(rc)
            promise.resolve(kh)
        } catch (e: Throwable) {
            promise.reject("keyhash_error", e.message, e)
        }
    }

    @ReactMethod
    fun login(promise: Promise) {
        val act = rc.currentActivity
        if (act == null) {
            promise.reject("no_activity", "No current activity")
            return
        }

        val cb: (OAuthToken?, Throwable?) -> Unit = { token, error ->
            if (error != null) {
                promise.reject("kakao_error", error.message ?: "kakao error", error)
            } else if (token == null) {
                promise.reject("no_token", "No token")
            } else {
                UserApiClient.instance.me { user, e ->
                    if (e != null || user == null) {
                        promise.reject("profile_error", e?.message ?: "profile error", e)
                    } else {
                        val res =
                                Arguments.createMap().apply {
                                    putString("accessToken", token.accessToken)
                                    putString("refreshToken", token.refreshToken)
                                    putString("id", user.id?.toString())
                                    putString("email", user.kakaoAccount?.email)
                                    putString("nickname", user.kakaoAccount?.profile?.nickname)
                                    putString(
                                            "photoURL",
                                            user.kakaoAccount?.profile?.profileImageUrl
                                    )
                                }
                        promise.resolve(res)
                    }
                }
            }
        }

        if (UserApiClient.instance.isKakaoTalkLoginAvailable(act)) {
            UserApiClient.instance.loginWithKakaoTalk(act, callback = cb)
        } else {
            UserApiClient.instance.loginWithKakaoAccount(act, callback = cb)
        }
    }

    // 계정 로그인(UI 강제) 테스트용
    @ReactMethod
    fun loginWithAccount(promise: Promise) {
        val act = rc.currentActivity
        if (act == null) {
            promise.reject("no_activity", "No current activity")
            return
        }

        val cb: (OAuthToken?, Throwable?) -> Unit = { token, error ->
            if (error != null) {
                promise.reject("kakao_error", error.message ?: "kakao error", error)
            } else if (token == null) {
                promise.reject("no_token", "No token")
            } else {
                UserApiClient.instance.me { user, e ->
                    if (e != null || user == null) {
                        promise.reject("profile_error", e?.message ?: "profile error", e)
                    } else {
                        val res =
                                Arguments.createMap().apply {
                                    putString("accessToken", token.accessToken)
                                    putString("refreshToken", token.refreshToken)
                                    putString("id", user.id?.toString())
                                    putString("email", user.kakaoAccount?.email)
                                    putString("nickname", user.kakaoAccount?.profile?.nickname)
                                    putString(
                                            "photoURL",
                                            user.kakaoAccount?.profile?.profileImageUrl
                                    )
                                }
                        promise.resolve(res)
                    }
                }
            }
        }

        UserApiClient.instance.loginWithKakaoAccount(act, callback = cb)
    }

    @ReactMethod
    fun logout(promise: Promise) {
        UserApiClient.instance.logout { e ->
            if (e != null) promise.reject("logout_error", e.message, e) else promise.resolve(true)
        }
    }
}
