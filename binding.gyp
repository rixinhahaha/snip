{
  "targets": [
    {
      "target_name": "window_utils",
      "sources": ["src/native/window_utils.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "OTHER_CFLAGS": ["-ObjC++"]
          },
          "link_settings": {
            "libraries": ["-framework Cocoa"]
          }
        }]
      ]
    }
  ]
}
