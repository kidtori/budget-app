package com.kidtori.budget;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeAuth")
public class NativeAuthPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.length() == 0) {
            call.reject("Missing auth URL.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        getActivity().startActivity(intent);
        call.resolve();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        Uri data = intent.getData();
        if (data == null) return;
        if (!"com.kidtori.budget".equals(data.getScheme()) || !"oauth".equals(data.getHost())) return;

        JSObject payload = new JSObject();
        payload.put("url", data.toString());
        notifyListeners("oauthComplete", payload, true);
    }
}
