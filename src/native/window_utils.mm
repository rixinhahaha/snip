#include <napi.h>
#include <algorithm>
#include <map>
#include <vector>
#include <string>
#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>

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

// Get on-screen window list with bounds, owner, and title.
// Sub-windows from the same app (PID) are merged into a single bounding rect
// so that clicking a browser selects the full window, not individual sub-panes.
// Returns an array of { x, y, width, height, owner, name, layer } objects
// sorted by area ascending (smallest first). Filters to the specified display bounds.
//
// Usage from JS:
//   const windows = windowUtils.getWindowList(displayX, displayY, displayW, displayH);
Napi::Value GetWindowList(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Optional display bounds filter
  double dispX = 0, dispY = 0, dispW = 0, dispH = 0;
  bool hasDisplayFilter = (info.Length() >= 4);
  if (hasDisplayFilter) {
    dispX = info[0].As<Napi::Number>().DoubleValue();
    dispY = info[1].As<Napi::Number>().DoubleValue();
    dispW = info[2].As<Napi::Number>().DoubleValue();
    dispH = info[3].As<Napi::Number>().DoubleValue();
  }

  CFArrayRef windowList = CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID
  );

  if (!windowList) {
    return Napi::Array::New(env, 0);
  }

  CFIndex count = CFArrayGetCount(windowList);

  // First pass: collect all qualifying windows grouped by owner PID.
  // CGWindowList returns sub-windows (toolbar, content area, etc.) as separate
  // entries. We merge them per-app so clicking a browser selects the full window.
  struct WinInfo {
    CGRect bounds;
    std::string owner;
    std::string name;
    pid_t pid;
    double largestSubArea; // area of the largest sub-window (for name tracking)
  };

  // Map from PID -> merged bounding rect + metadata (from the largest window)
  std::map<pid_t, WinInfo> mergedByPid;

  for (CFIndex i = 0; i < count; i++) {
    NSDictionary* entry = (__bridge NSDictionary*)CFArrayGetValueAtIndex(windowList, i);

    // Skip windows with layer != 0 (menu bar, dock, etc.)
    int layer = [entry[(__bridge NSString*)kCGWindowLayer] intValue];
    if (layer != 0) continue;

    // Get bounds
    CGRect bounds;
    NSDictionary* boundsDict = entry[(__bridge NSString*)kCGWindowBounds];
    if (!boundsDict) continue;
    CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDict, &bounds);

    // Skip tiny windows (< 50px in either dimension)
    if (bounds.size.width < 50 || bounds.size.height < 50) continue;

    // If display filter provided, skip windows that don't intersect
    if (hasDisplayFilter) {
      CGRect dispRect = CGRectMake(dispX, dispY, dispW, dispH);
      if (!CGRectIntersectsRect(bounds, dispRect)) continue;
    }

    NSString* owner = entry[(__bridge NSString*)kCGWindowOwnerName] ?: @"";
    NSString* name  = entry[(__bridge NSString*)kCGWindowName] ?: @"";

    // Skip our own overlay
    if ([owner isEqualToString:@"Snip"] || [owner isEqualToString:@"Electron"]) continue;

    pid_t pid = [entry[(__bridge NSString*)kCGWindowOwnerPID] intValue];
    double area = bounds.size.width * bounds.size.height;

    auto it = mergedByPid.find(pid);
    if (it == mergedByPid.end()) {
      mergedByPid[pid] = {
        bounds,
        std::string([owner UTF8String]),
        std::string([name UTF8String]),
        pid,
        area
      };
    } else {
      // Merge: union of bounding rects
      it->second.bounds = CGRectUnion(it->second.bounds, bounds);
      // Keep the name from the largest sub-window (usually the main window title)
      if (area > it->second.largestSubArea && [name length] > 0) {
        it->second.name = std::string([name UTF8String]);
        it->second.largestSubArea = area;
      }
    }
  }

  // Sort by area ascending so findWindowAt picks the smallest (most specific)
  // window first when multiple merged rects overlap at the cursor position.
  std::vector<WinInfo> sorted;
  sorted.reserve(mergedByPid.size());
  for (auto& kv : mergedByPid) {
    sorted.push_back(kv.second);
  }
  std::sort(sorted.begin(), sorted.end(), [](const WinInfo& a, const WinInfo& b) {
    double areaA = a.bounds.size.width * a.bounds.size.height;
    double areaB = b.bounds.size.width * b.bounds.size.height;
    return areaA < areaB;
  });

  Napi::Array result = Napi::Array::New(env);
  uint32_t idx = 0;
  for (auto& w : sorted) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("x", Napi::Number::New(env, w.bounds.origin.x));
    obj.Set("y", Napi::Number::New(env, w.bounds.origin.y));
    obj.Set("width", Napi::Number::New(env, w.bounds.size.width));
    obj.Set("height", Napi::Number::New(env, w.bounds.size.height));
    obj.Set("owner", Napi::String::New(env, w.owner));
    obj.Set("name", Napi::String::New(env, w.name));
    obj.Set("layer", Napi::Number::New(env, 0));
    result.Set(idx++, obj);
  }

  CFRelease(windowList);
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setMoveToActiveSpace",
              Napi::Function::New(env, SetMoveToActiveSpace));
  exports.Set("getWindowList",
              Napi::Function::New(env, GetWindowList));
  return exports;
}

NODE_API_MODULE(window_utils, Init)
