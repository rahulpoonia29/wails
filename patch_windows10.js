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

// Let's use `globalApplication.dispatchOnMainThread` without waiting for the result!
// If `execJS` works, it means `globalApplication.dispatchOnMainThread` is the CORRECT thread.
// Wait, the error occurs WHEN I block the current thread using `wg.Wait()` or `<-resultChan`!
// Why does blocking the calling thread cause COM to fail inside the dispatched function?
// Ah! Wails' `WebViewNavigationCompleted` is a COM callback!
// COM is a single-threaded apartment (STA). The UI thread is currently INSIDE the NavigationCompleted callback!
// If I block the UI thread inside the callback using `wg.Wait()`, and the dispatched function is posted to the UI thread's message queue via `dispatchOnMainThread`, it will NEVER execute because the UI thread is stuck waiting for it!
// AND Wails events run in goroutines... Wait, DO THEY?
// If Wails events run in goroutines, then the calling thread is a goroutine, not the UI thread.
// BUT `navigationCompleted` callback from WebView2 runs on the UI thread!
// Let's check `webview_window_windows.go` line 1963: `chromium.NavigationCompletedCallback = w.navigationCompleted`
// And `navigationCompleted` does `w.parent.emit(events.Windows.WebViewNavigationCompleted)`.
// `emit` executes synchronously or asynchronously? Wails events execute synchronously by default?
// If `emit` executes synchronously on the UI thread, then `wg.Wait()` blocks the UI thread, causing deadlock!
// But wait, the error is NOT deadlock. The error is "This method can only be called from the thread that created the object."
// Wait... if the current thread IS the UI thread (because it's a callback from WebView2), then I don't need to dispatch to the main thread at all!
// Let's just run it DIRECTLY! No dispatching, no goroutines!

file = file.replace(/func \(w \*windowsWebviewWindow\) getCookies[\s\S]*?func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	// We are likely being called directly from a WebView2 callback or Wails event handler on the UI thread.
	// We MUST NOT dispatch to another thread if we are already on the UI thread.
	// But what if the user calls GetCookies from a background goroutine?
	// We need to check if we are on the UI thread.
	// But for now, let's just try directly and assume the user called it from a Wails event handler (UI thread).
	// ACTUALLY, "This method can only be called from the thread that created the object." happened when I DID dispatch!
	// Wait, did it? No, in my first patch I called it directly without dispatching.
	// So calling it directly failed because the event handler WAS on a background thread!
	// Wails event handlers ARE executed on background threads!
	// If Wails event handlers are on background threads, then I MUST dispatch.
	// BUT `globalApplication.dispatchOnMainThread` posts a message.
	// And `InvokeSync` posts a message.
	// Why does it fail even inside `InvokeSync` or `dispatchOnMainThread`?
	// Oh... `globalApplication.dispatchOnMainThread` posts to `globalApplication.mainWindow`... wait, does it?
	
	var cookies []*http.Cookie
	
	// Let's use a channel to block the caller until the UI thread completes the task.
	resultChan := make(chan []*http.Cookie, 1)
	
	// Wails uses globalApplication.dispatchOnMainThread for execJS.
	globalApplication.dispatchOnMainThread(func() {
		// INSIDE HERE we are on the Wails main thread.
		var cm *edge.ICoreWebView2CookieManager
		var err error
		
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

	return <-resultChan
}

func (w *windowsWebviewWindow) execJS(js string) {`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
