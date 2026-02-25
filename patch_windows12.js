const fs = require('fs');

let file = fs.readFileSync('v3/pkg/application/webview_window_windows.go', 'utf8');

file = file.replace(/func \(w \*windowsWebviewWindow\) getCookies[\s\S]*?func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	resultChan := make(chan []*http.Cookie, 1)

	// In wails/v3, window events are executed on the application's dispatch thread OR a goroutine?
	// The problem is w.chromium COM object was created on the window's creation thread.
	// Windows UI thread. 
	// Wails v3 has a mechanism to run code on a specific window's thread!
	// Is there w.parent.dispatchOnMainThread() ? No, but there is w32.PostMessage to w.hwnd!
	// Let's use runtime.EventsEmit to see where we are? No.
	// Actually, let's look at windows WebviewWindow struct in go-webview2.
	
	// Let's use InvokeSync
	InvokeSync(func() {
		var err error
		var cm *edge.ICoreWebView2CookieManager
		
		cm, err = w.chromium.GetCookieManager()
		if err != nil {
			fmt.Println("Error getting cookie manager inside InvokeSync:", err)
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
