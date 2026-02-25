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

// Let's use standard w32 window post message or whatever is used to run on main thread
// But wait! `GetCookieManager` needs the thread that created the Chromium *object*,
// which might be the main thread, or it might be another thread.
// We can use w.parent.Application().dispatchOnMainThread ? 
// Actually w.hwnd is the window, so we can post a message to it to do the work!
// BUT go-webview2 has a helper:
// chromium.NotifyParentWindowPositionChanged() executes on the webview thread... no that's just a method.
// Wait, w.parent.ExecJS() uses `globalApplication.dispatchOnMainThread(func() { w.impl.execJS(js) })`
// Oh wait, my JS patch was using `globalApplication.dispatchOnMainThread`, let's try `w32.InvokeSync` if it exists, or look for how wails posts to the window thread!
// Wails has InvokeSync(func()) in the runtime.

file = file.replace(/func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	var cookies []*http.Cookie
	
	resultChan := make(chan []*http.Cookie, 1)
	
	// InvokeSync guarantees it runs on the main Wails thread
	InvokeSync(func() {
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
