const fs = require('fs');

let file = fs.readFileSync('v3/pkg/application/webview_window_windows.go', 'utf8');

file = file.replace(`import (
	"errors"
	"fmt"
	"net/url"`, `import (
	"errors"
	"fmt"
	"net/http"
	"net/url"`);

// Let's use the COM way. The WebView2 object might be on another thread, BUT go-webview2 has
// a dispatch function for the Chromium edge!
// w.chromium.Dispatch(func()) might exist? No.
// But w.chromium.Eval is dispatched somehow or maybe it just uses COM?
// Let's look at go-webview2 pkg/edge Chromium struct.
// No wait, the error is COM telling us we are not on the creating thread.
// Wait! w.hwnd is the window. Wails' w32 package has w32.SendMessage. 
// Can we just use a custom message or queue an APC?
// Wails has globalApplication.dispatchOnMainThread() which just uses PostMessage(app.mainWindow, WM_APP+1, ...).
// But the webview might be running in a separate thread from the main window? No, they are both same thread.
// Oh! w.chromium isn't fully initialized? No it is.
// Actually `NavigationCompleted` event is fired from a callback!
// The callback `navigationCompleted(sender, args)` comes from WebView2.
// WebView2 COM callbacks ARE executed on the UI thread!
// Wait! If the callback is already on the UI thread, why does InvokeSync or `GetCookies` fail?
// Let's try running it DIRECTLY, with no InvokeSync or dispatchOnMainThread, because we might already be on the correct thread.
// Ah, the issue was originally I DID run it directly and it failed!
// "Error getting cookie manager: failed to get cookie manager: This method can only be called from the thread that created the object."
// That means the event handler in Wails `OnWindowEvent(events.Windows.WebViewNavigationCompleted...)` is executed in a background goroutine!
// Wails event callbacks are dispatched in goroutines!
// So Wails' `InvokeSync` posts to the application thread. But the application thread might not be the WebView2 thread.
// Wait, `windowsWebviewWindow` has `w.parent.Run()` ?
// Let's check `webview_window_windows.go` `execJS`:
// func (w *windowsWebviewWindow) execJS(js string) {
// 	globalApplication.dispatchOnMainThread(func() { w.chromium.Eval(js) })
// }
// Wait, if execJS uses `globalApplication.dispatchOnMainThread` and it WORKS, then `dispatchOnMainThread` MUST be the correct thread!
// BUT my patch failed with the same error even inside `dispatchOnMainThread`! WHY?
// Because `dispatchOnMainThread` posts a message and executes asynchronously!
// BUT wait, in my Patch 4 I used `globalApplication.dispatchOnMainThread(func() { defer wg.Done() ... })` and wait on `wg.Wait()`.
// If I use `wg.Wait()` inside a Wails event handler (which might be holding some lock?), maybe it deadlocks or maybe the main thread is blocked?
// No, the error wasn't a deadlock, the error was "This method can only be called from the thread that created the object."
// WAIT, look closely at the patch4 error:
// "Error getting cookie manager: failed to get cookie manager: This method can only be called from the thread that created the object."
// Is `globalApplication.dispatchOnMainThread` running on the UI thread? Yes.
// Let's check w.chromium.CallOnMainThread or w.chromium.Dispatch?

file = file.replace(/func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	var cookies []*http.Cookie
	
	resultChan := make(chan []*http.Cookie, 1)
	
	// Let's do exactly what Wails uses for window methods.
	// In windows, w32 has a hidden window for messages.
	globalApplication.dispatchOnMainThread(func() {
		var err error
		var cm *edge.ICoreWebView2CookieManager
		
		cm, err = w.chromium.GetCookieManager()
		if err != nil {
			fmt.Println("Error getting cookie manager:", err)
			resultChan <- nil
			return
		}
		defer cm.Release()

		list, err := cm.GetCookies(url)
		if err != nil {
			fmt.Println("Error getting cookies list:", err)
			resultChan <- nil
			return
		}
		defer list.Release()

		count, err := list.GetCount()
		if err != nil {
			fmt.Println("Error getting count:", err)
			resultChan <- nil
			return
		}

		var found []*http.Cookie
		for i := uint32(0); i < count; i++ {
			cookie, err := list.GetItem(i)
			if err != nil {
				continue
			}

			name, _ := cookie.GetName()
			value, _ := cookie.GetValue()
			domain, _ := cookie.GetDomain()
			path, _ := cookie.GetPath()
			expires, _ := cookie.GetExpires()
			isHttpOnly, _ := cookie.GetIsHttpOnly()
			isSecure, _ := cookie.GetIsSecure()

			found = append(found, &http.Cookie{
				Name:     name,
				Value:    value,
				Domain:   domain,
				Path:     path,
				Expires:  time.Unix(int64(expires), 0),
				HttpOnly: isHttpOnly,
				Secure:   isSecure,
			})
			cookie.Release()
		}
		
		resultChan <- found
	})

	cookies = <-resultChan
	return cookies
}

func (w *windowsWebviewWindow) execJS(js string) {`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
