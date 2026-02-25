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

// Let's also restore the original getCookies and patch it with the correct sync wait
file = file.replace(/func \(w \*windowsWebviewWindow\) getCookies[\s\S]*?func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	var cookies []*http.Cookie
	var wg sync.WaitGroup
	wg.Add(1)

	globalApplication.dispatchOnMainThread(func() {
		defer wg.Done()
		
		// The environment has the cookie manager, not the chromium wrapper itself
		env, err := w.chromium.Environment()
		if err != nil {
			fmt.Println("Error getting environment:", err)
			return
		}
		
		cm, err := w.chromium.GetCookieManager()
		if err != nil {
			fmt.Println("Error getting cookie manager:", err)
			return
		}
		defer cm.Release()

		list, err := cm.GetCookies(url)
		if err != nil {
			fmt.Println("Error getting cookies list:", err)
			return
		}
		defer list.Release()

		count, err := list.GetCount()
		if err != nil {
			fmt.Println("Error getting count:", err)
			return
		}

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

			cookies = append(cookies, &http.Cookie{
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
	})

	wg.Wait()
	return cookies
}

func (w *windowsWebviewWindow) execJS(js string) {`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
