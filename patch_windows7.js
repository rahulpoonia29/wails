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
// Actually, `GetCookies` returns a deferral in native WebView2? No, go-webview2 makes it sync.

file = file.replace(/func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	var cookies []*http.Cookie
	
	// Try without any goroutines or waitgroups first
	// Just use InvokeSync with a channel
	
	resultChan := make(chan []*http.Cookie, 1)
	
	globalApplication.dispatchOnMainThread(func() {
		var err error
		var cm *edge.ICoreWebView2CookieManager
		
		// WebView2 COM objects must be accessed from the thread they were created on
		// Usually this is the thread that called w.setupChromium() which is called from WndProc.
		
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
