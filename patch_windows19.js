const fs = require('fs');

let file = fs.readFileSync('v3/pkg/application/webview_window_windows.go', 'utf8');

// I got a Segfault! Exception 0xc0000005 0x0 0x8 0x7fff0b3db601
// Where? 
// github.com/wailsapp/go-webview2/pkg/edge.ComProc.Call(0x7fff0b3db5d0, {0xc0001312a8?, 0x0?, 0x0?})
// github.com/wailsapp/go-webview2/pkg/edge.(*ICoreWebView2CookieManager).GetCookies(0x175000044b40, {0x7ff62c6817e9, 0x12})
// github.com/wailsapp/wails/v3/pkg/application.(*windowsWebviewWindow).WndProc(0xc000286000, 0x8064, 0xc000231e70, 0x0)
// This segfault is inside `GetCookies` method of ICoreWebView2CookieManager!
// Why did `GetCookies(url)` segfault? 
// Because the COM object pointer `cm` is invalid?
// Wait! I did:
// `cm, err := w.chromium.GetCookieManager()`
// Let's check `go-webview2/pkg/edge/ICoreWebView2CookieManager.go`
// It does `cm.vtbl.GetCookies.Call(uintptr(unsafe.Pointer(cm)), uintptr(unsafe.Pointer(uri)), uintptr(unsafe.Pointer(&cookieList)))`
// The `uri` parameter to `GetCookies` MUST be a *uint16 (a wide string)!
// Wait! `GetCookies(uri string)` in go-webview2.
// Let's look at go-webview2 implementation of `GetCookies`. 
// If go-webview2 expects a Go string, it handles the conversion.
// BUT why did it segfault? Maybe `w.chromium.GetCookieManager()` returned a bad pointer?
// In Wails v3, go-webview2 is imported as `github.com/wailsapp/go-webview2`.

// Wait, is it because `GetCookies` is not supported on this version of WebView2?
// No, the error wasn't unsupported interface, it was a crash.
// Let's look at go-webview2 `GetCookies`!
// Maybe I should just check if `cm` is nil before using it?
// `cm` isn't nil, but `w.chromium` might be partially initialized?
// Or maybe I passed the URL incorrectly? It's a standard Go string.

// ACTUALLY, `go-webview2` version is `v1.0.23`.
// Let's rewrite `getCookies` one more time.
// Since we found out the UI thread IS needed, but my SendMessage approach crashed inside `GetCookies`.
// Is `w.chromium.GetCookieManager()` returning a valid pointer?
// `cm, err := w.chromium.GetCookieManager()`
// Yes, `err` was nil.
// If it segfaulted, maybe `GetCookies` crashed because `GetCookies` does NOT take a Go string but rather a COM string?
// No, `GetCookies` in go-webview2 definitely takes a Go string!
// Let's check `w.chromium.GetCookieManager` in `go-webview2/pkg/edge/chromium.go`.

// Wait! Does `w.chromium.GetCookieManager()` return a new interface reference? YES, it queries ICoreWebView2_2.
// If I use `cm.GetCookies(url)` it crashes inside `Call()`.
// This usually means either `cm` is an invalid COM pointer OR I'm calling it on the wrong thread.
// Wait, `WndProc` IS the correct thread, because it's the thread that created the window!
// But is it the thread that created the WebView2 environment?
// In Wails v3, the WebView2 Environment is SHARED across all windows!
// Wait! `webviewloader.CreateCoreWebView2EnvironmentWithOptions` is called ONCE per app!
// That means the WebView2 Environment is created on the APP'S MAIN THREAD, NOT the window's thread!
// Ah! `globalApplication.dispatchOnMainThread` IS the correct thread for the environment!
// That explains why `GetCookieManager` complained about the wrong thread when I called it from the event handler (background thread).
// BUT when I called it from `globalApplication.dispatchOnMainThread`, it STILL failed!
// Why did it fail inside `dispatchOnMainThread`?
// Let's look at `dispatchOnMainThread`:
// func (a *App) dispatchOnMainThread(fn func()) {
//    a.impl.dispatchOnMainThread(id)
// }
// This posts a message to `globalApplication.mainWindow` if there is one!
// But if there is no `mainWindow` or it's a different window, maybe it's not the UI thread?

// How does Wails create the Shared Environment?
// In `application_windows.go: runMainLoop()`.
// So the APP'S thread is the UI thread!
// If I use `w.parent.Application().dispatchOnMainThread(func() {})`, it runs on that thread.
// So why did my earlier patch4 fail with "This method can only be called from the thread that created the object"?
// In patch4, I used `globalApplication.dispatchOnMainThread`. Let's check Patch4 output again:
// "Error getting cookie manager: failed to get cookie manager: This method can only be called from the thread that created the object."
// Wait, did that error come from INSIDE `dispatchOnMainThread`, or OUTSIDE?
// Ah! In Patch4 I wrote:
// env, err := w.chromium.Environment()
// cm, err := w.chromium.GetCookieManager()
// And the error was "failed to get cookie manager: This method can only be called from the thread that created the object."
// WAIT! If it ran inside `dispatchOnMainThread`, it means `dispatchOnMainThread` IS NOT THE THREAD THAT CREATED THE CHROMIUM OBJECT!
// The thread that created the chromium object is the WINDOW'S THREAD!
// Because each window has its own `edge.Chromium` instance!
// "w.chromium = edge.NewChromium()" is called in `w.setupChromium()`, which is called from `WndProc`!
// So `w.chromium` COM object is created on the Window's Thread!
// My Patch 14 used `w32.SendMessage(w.hwnd, ...)` to run on the Window's Thread!
// AND IT CRASHED with a segfault inside `GetCookies`!
// Why would `GetCookies` crash on the correct thread?
// Because `GetCookies` returns an `*ICoreWebView2CookieList` via an ASYNC COM callback!
// Wait! `GetCookies` might be an async method in the underlying WebView2 API?
// Let's look at the C++ API: `HRESULT GetCookies(LPCWSTR uri, ICoreWebView2GetCookiesCompletedHandler* handler)`
// YES! It is ASYNC! It takes a handler!
// If `go-webview2` implements `GetCookies` as a synchronous wrapper, it might be creating a handler, calling the async method, and waiting for an event!
// If we are blocking the UI thread inside `WndProc` using `SendMessage`, and `GetCookies` blocks waiting for the async callback to fire ON THE SAME UI THREAD, it will DEADLOCK or crash!
// Wait, `go-webview2` handles async by doing `SendMessage` pump internally? No, `go-webview2` might not!
// Let's check `go-webview2/pkg/edge/ICoreWebView2CookieManager.go`
// If it's async, `go-webview2` has `GetCookies` which probably blocks and pumps messages OR it is completely broken!

// Let's see how `go-webview2` implements `GetCookies`:
file = file.replace(/func \(w \*windowsWebviewWindow\) getCookies[\s\S]*?func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	// Because GetCookies might be async and crash if called from a blocking WndProc,
	// AND because the COM thread is the window thread,
	// Let's try w.chromium.GetCookieManager() inside a goroutine and use InvokeSync? No, InvokeSync uses the main thread.
	// We need to run on the window thread but NOT block it!
	// Is there a way to use go-webview2's GetCookies safely?
	// ACTUALLY, "GetCookies" does NOT return a value synchronously!
	// Wait, if it does, how does go-webview2 do it?
	// go-webview2 defines: func (i *ICoreWebView2CookieManager) GetCookies(uri string) (*ICoreWebView2CookieList, error)
	// If it was async, it would take a callback. But it returns the list directly!
	// It must be pumping messages.
	// The problem is that Wails v3 ALSO pumps messages.
	// If Wails v3 calls this from WndProc, maybe the re-entrant message pump corrupts Wails state and causes a segfault.

	// WHAT IF I DON'T USE SENDMESSAGE?
	// What if I use PostMessage? But PostMessage is async and I need to return the cookies!
	// We can use PostMessage, wait on a channel in the goroutine!
	
	req := &cookieRequest{
		url: url,
		resultChan: make(chan []*http.Cookie, 1),
	}
	
	// Use w32.PostMessage which does NOT block the UI thread while we wait.
	w32.PostMessage(w.hwnd, w32.WM_APP + 100, uintptr(unsafe.Pointer(req)), 0)

	return <-req.resultChan
}

func (w *windowsWebviewWindow) execJS(js string) {`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
