#include <napi.h>
#import <Cocoa/Cocoa.h>

// Set NSWindowCollectionBehaviorMoveToActiveSpace on an Electron BrowserWindow.
// This tells macOS to move the window to whichever Space is currently active
// when the window is shown, solving the issue where overlay windows appear
// on the wrong Space.
//
// Usage from JS:
//   const handle = browserWindow.getNativeWindowHandle();
//   windowUtils.setMoveToActiveSpace(handle);

Napi::Boolean SetMoveToActiveSpace(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected Buffer from getNativeWindowHandle()")
        .ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  // getNativeWindowHandle() returns a pointer to the NSView* as raw bytes.
  // Use __unsafe_unretained to avoid ARC ownership issues with reinterpret_cast.
  void* rawPtr = *reinterpret_cast<void**>(buf.Data());
  NSView* __unsafe_unretained view = (__bridge NSView*)rawPtr;
  NSWindow* window = [view window];

  if (window) {
    NSWindowCollectionBehavior behavior = [window collectionBehavior];
    // Remove canJoinAllSpaces (shows on every Space — not what we want)
    behavior &= ~NSWindowCollectionBehaviorCanJoinAllSpaces;
    // Add moveToActiveSpace (moves to current Space when shown)
    behavior |= NSWindowCollectionBehaviorMoveToActiveSpace;
    [window setCollectionBehavior:behavior];
    return Napi::Boolean::New(env, true);
  }

  return Napi::Boolean::New(env, false);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setMoveToActiveSpace",
              Napi::Function::New(env, SetMoveToActiveSpace));
  return exports;
}

NODE_API_MODULE(window_utils, Init)
