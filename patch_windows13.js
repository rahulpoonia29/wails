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

// Let's look at windows WebviewWindow struct in go-webview2.
// In go-webview2, `chromium.Eval(js)` internally checks for the thread. Wait, does it?
// Ah! If I use `globalApplication.dispatchOnMainThread()`, the thread is the MAIN thread.
// But the webview window might be running on a DIFFERENT thread!
// Windows forms and webviews can have their own threads.
// Wails creates the window in `w.run()` or `newWindowImpl()`?
// Let's use `w32.PostMessage(w.hwnd, ...)` instead to run on the WINDOW's thread!
// Wait! `w.parent.Run()` might be running on the main thread?
// Let's use `w.chromium.Eval` which just executes JS.
// Wait! If I just use `w.chromium.GetCookieManager()` from the `dispatchOnMainThread`, it failed.
// "failed to get cookie manager: This method can only be called from the thread that created the object"
// Okay, let's look at `dispatchOnMainThread` in `w.chromium`? No.
// Let's check `w.parent.Application().dispatchOnMainThread()`? It's the same as `globalApplication.dispatchOnMainThread`.
// Wait, if `execJS` uses `globalApplication.dispatchOnMainThread` and it WORKS, then `w.chromium.Eval(js)` works on that thread.
// But `w.chromium.GetCookieManager()` FAILS on that thread? That's impossible if they both require the same thread.
// UNLESS `w.chromium.Eval()` internally posts a message to the correct thread!
// Let's check `go-webview2/pkg/edge/chromium.go` for `Eval()` method!
// Actually, `navigationCompleted` is an event raised by WebView2. It runs on the WebView2 thread!
// In Wails, `navigationCompleted` callback is:
// func (w *windowsWebviewWindow) navigationCompleted(sender *edge.ICoreWebView2, args *edge.ICoreWebView2NavigationCompletedEventArgs) {
// 	 w.parent.emit(events.Windows.WebViewNavigationCompleted)
// }
// `w.parent.emit` is asynchronous. The event listener runs in a separate goroutine.
// To get back to the WebView2 thread, what can we do?
// In Windows, a window has an associated thread. We can send a message to `w.hwnd` using a custom message id to execute a callback.
// Or we can use `w32.PostMessage`. But we need to handle it in `WndProc`.
// This is exactly what `dispatchOnMainThread` does, but for `globalApplication.mainWindow`.
// If `w.hwnd` is NOT the main window, it runs on a different thread!
// Yes! Each window might have its own thread in Wails?
// Wait, Wails v3 `dispatchOnMainThread` just executes on the `globalApplication.mainWindow` thread.
// If the webview window was created on the main thread, it's the same thread.
// BUT Wails v3 supports multiple windows. Are they on the same thread?
// Wails v3 windows run on the MAIN thread. All of them.
// "Error getting cookie manager inside InvokeSync: failed to get cookie manager: This method can only be called from the thread that created the object."
// This means the thread running `InvokeSync` is NOT the thread that created `w.chromium`!

file = file.replace(/func \(w \*windowsWebviewWindow\) setMaxSize/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	resultChan := make(chan []*http.Cookie, 1)

	// Since globalApplication.dispatchOnMainThread fails, it means it's NOT the right thread.
	// But execJS uses globalApplication.dispatchOnMainThread and it works?
	// Let's test if execJS works directly.
	// Actually, I can use w32.SendMessage to the window itself!
	// But Wails doesn't have a built-in generic SendMessage callback for any window.
	// Let's try running it in a new goroutine and use runtime.LockOSThread()? No, that won't work.
	
	// Wait, is there a QueueUserAPC or something?
	// Let's use window.ExecJS to get cookies as a fallback? No, HttpOnly cookies can't be read.

	// Let's look at go-webview2. It has chromium.NotifyParentWindowPositionChanged().
	// There is a method in Chromium: w.chromium.CallOnMainThread?
	// Let's check w.chromium methods using reflection? Or just try:
	// w.chromium.Dispatch(func()) ?
	
	// Let's try sending a dummy message to the window and handling it in WndProc!
	// No, we can't easily hook WndProc from here without modifying it.
	// BUT wait, I CAN modify WndProc! It's in this very file!

	globalApplication.dispatchOnMainThread(func() {
		// Wait, if execJS works with dispatchOnMainThread, why does GetCookieManager fail?
		// Is it because GetCookieManager requires the environment?
		env, err := w.chromium.Environment()
		if err != nil {
			fmt.Println("Error getting env", err)
		} else {
			fmt.Println("Got env successfully on main thread!")
		}
		
		cm, err := w.chromium.GetCookieManager()
		if err != nil {
			fmt.Println("Error getting cookie manager inside dispatchOnMainThread:", err)
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

func (w *windowsWebviewWindow) setMaxSize`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
