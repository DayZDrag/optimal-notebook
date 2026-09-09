package app.vaultterminal.notebook;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONException;
import java.util.Map;

@CapacitorPlugin(name = "ReminderAlarm", permissions = {
        @Permission(alias = "notifications", strings = {android.Manifest.permission.POST_NOTIFICATIONS})
})
public class ReminderAlarmPlugin extends Plugin {
    private JSObject status() {
        JSObject result = new JSObject();
        result.put("notifications", ReminderAlarmManager.notificationsAllowed(getContext()));
        result.put("exactAlarms", ReminderAlarmManager.exactAlarmsAllowed(getContext()));
        result.put("fullScreen", ReminderAlarmManager.fullScreenAllowed(getContext()));
        return result;
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if(Build.VERSION.SDK_INT < 33 || ReminderAlarmManager.notificationsAllowed(getContext())) { call.resolve(status()); return; }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if(Build.VERSION.SDK_INT >= 31 && !ReminderAlarmManager.exactAlarmsAllowed(getContext())) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve(status());
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        if(Build.VERSION.SDK_INT >= 34 && !ReminderAlarmManager.fullScreenAllowed(getContext())) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve(status());
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        String id = call.getString("id");
        String title = call.getString("title");
        Double at = call.getDouble("at");
        if(id == null || id.trim().isEmpty() || title == null || title.trim().isEmpty() || at == null || at <= 0) { call.reject("Некорректное системное напоминание"); return; }
        boolean exact = ReminderAlarmManager.schedule(getContext(), new ReminderAlarmManager.Entry(id, title, call.getString("body", ""), at.longValue()));
        JSObject result = new JSObject();
        result.put("exact", exact);
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if(id == null || id.trim().isEmpty()) { call.reject("Не задан ID напоминания"); return; }
        ReminderAlarmManager.cancel(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void getPendingActions(PluginCall call) {
        JSArray actions = new JSArray();
        for(Map.Entry<String, ?> record : ReminderAlarmManager.records(getContext()).entrySet()) {
            if(!record.getKey().startsWith("action:") || !(record.getValue() instanceof String))continue;
            try { actions.put(new JSObject((String) record.getValue())); }
            catch(JSONException ignored) { ReminderAlarmManager.acknowledge(getContext(), record.getKey().substring("action:".length())); }
        }
        JSObject result = new JSObject();
        result.put("actions", actions);
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledgeActions(PluginCall call) {
        JSArray ids = call.getArray("ids");
        if(ids != null) for(int index = 0; index < ids.length(); index++) {
            try { ReminderAlarmManager.acknowledge(getContext(), ids.getString(index)); }
            catch(JSONException ignored) { }
        }
        call.resolve();
    }
}
