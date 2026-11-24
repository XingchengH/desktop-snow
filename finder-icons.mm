#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <node_api.h>

static id Attribute(AXUIElementRef element, CFStringRef key) {
    CFTypeRef value = nullptr;
    if (AXUIElementCopyAttributeValue(element, key, &value) != kAXErrorSuccess) return nil;
    return CFBridgingRelease(value);
}

static napi_value Property(napi_env env, napi_value object, const char *key, double number) {
    napi_value value;
    napi_create_double(env, number, &value);
    napi_set_named_property(env, object, key, value);
    return value;
}

static void Visit(napi_env env, napi_value items, AXUIElementRef element, int depth, uint32_t &count) {
    if (depth >= 6 || count >= 250) return;
    NSString *role = Attribute(element, kAXRoleAttribute);
    NSString *subrole = Attribute(element, kAXSubroleAttribute);
    if ([role isEqualToString:@"AXMenuBar"] || [role isEqualToString:@"AXMenu"] ||
        [role isEqualToString:@"AXMenuItem"]) return;
    if ([role isEqualToString:@"AXWindow"] && ![subrole isEqualToString:@"AXDesktop"]) {
        NSString *title = Attribute(element, kAXTitleAttribute);
        if (![title isEqualToString:@"Desktop"] && ![title isEqualToString:@"桌面"]) return;
    }
    if ([role isEqualToString:@"AXImage"] || [role isEqualToString:@"AXIcon"] ||
        [subrole isEqualToString:@"AXIcon"]) {
        id position = Attribute(element, kAXPositionAttribute);
        id size = Attribute(element, kAXSizeAttribute);
        CGPoint point;
        CGSize dimensions;
        if (!position || !size || CFGetTypeID((__bridge CFTypeRef)position) != AXValueGetTypeID() ||
            CFGetTypeID((__bridge CFTypeRef)size) != AXValueGetTypeID() ||
            !AXValueGetValue((__bridge AXValueRef)position, kAXValueTypeCGPoint, &point) ||
            !AXValueGetValue((__bridge AXValueRef)size, kAXValueTypeCGSize, &dimensions) ||
            dimensions.width < 16 || dimensions.width > 220 ||
            dimensions.height < 16 || dimensions.height > 240) return;
        const double insetX = fmin(12, dimensions.width * 0.14);
        const double insetY = fmin(6, dimensions.height * 0.08);
        napi_value bounds;
        napi_create_object(env, &bounds);
        Property(env, bounds, "id", -100000.0 - (CFHash(element) % 1000000000));
        Property(env, bounds, "x", point.x + insetX);
        Property(env, bounds, "y", point.y + insetY);
        Property(env, bounds, "width", dimensions.width - 2 * insetX);
        Property(env, bounds, "height", dimensions.height - insetY);
        napi_set_element(env, items, count++, bounds);
        return;
    }
    id children = Attribute(element, kAXChildrenAttribute);
    if ([children isKindOfClass:[NSArray class]]) {
        for (id child in children) {
            if (count >= 250) break;
            if (CFGetTypeID((__bridge CFTypeRef)child) == AXUIElementGetTypeID()) {
                Visit(env, items, (__bridge AXUIElementRef)child, depth + 1, count);
            }
        }
    }
}

static napi_value Read(napi_env env, napi_callback_info info) {
    @autoreleasepool {
        napi_value items;
        napi_create_array(env, &items);
        if (!AXIsProcessTrusted()) return items;
        NSRunningApplication *finder =
            [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.finder"].firstObject;
        if (!finder) return items;
        AXUIElementRef root = AXUIElementCreateApplication(finder.processIdentifier);
        AXUIElementSetMessagingTimeout(root, 0.15);
        uint32_t count = 0;
        Visit(env, items, root, 0, count);
        if (count == 0) {
            id windows = Attribute(root, kAXWindowsAttribute);
            if ([windows isKindOfClass:[NSArray class]]) {
                for (id window in windows) {
                    if (CFGetTypeID((__bridge CFTypeRef)window) == AXUIElementGetTypeID()) {
                        Visit(env, items, (__bridge AXUIElementRef)window, 0, count);
                    }
                }
            }
        }
        CFRelease(root);
        return items;
    }
}

NAPI_MODULE_INIT() {
    napi_value read;
    napi_create_function(env, "read", NAPI_AUTO_LENGTH, Read, nullptr, &read);
    napi_set_named_property(env, exports, "read", read);
    return exports;
}
