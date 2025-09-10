if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "/Users/sungwon/.gradle/caches/8.14.3/transforms/d3af2c2304e048873ee9c98f530c007d/transformed/hermes-android-0.81.0-release/prefab/modules/libhermes/libs/android.arm64-v8a/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/sungwon/.gradle/caches/8.14.3/transforms/d3af2c2304e048873ee9c98f530c007d/transformed/hermes-android-0.81.0-release/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

