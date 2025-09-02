if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "/Users/gimsangmi/.gradle/caches/8.14.3/transforms/0bbe90311867cbf06a1c6b120f0f0b7d/transformed/hermes-android-0.81.0-debug/prefab/modules/libhermes/libs/android.armeabi-v7a/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/gimsangmi/.gradle/caches/8.14.3/transforms/0bbe90311867cbf06a1c6b120f0f0b7d/transformed/hermes-android-0.81.0-debug/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

