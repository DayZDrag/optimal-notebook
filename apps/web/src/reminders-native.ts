import { registerPlugin } from '@capacitor/core';
import type { Reminder } from '../../../packages/shared/src/index';
import { isNativeAndroid } from './native';

export interface NativeReminderStatus {
  notifications: boolean;
  exactAlarms: boolean;
  fullScreen: boolean;
}

export interface NativeReminderAction {
  id: string;
  status: 'FIRED'|'DONE'|'SNOOZED';
  remindAt?: number;
}

interface ReminderAlarmPlugin {
  status(): Promise<NativeReminderStatus>;
  requestNotificationPermission(): Promise<NativeReminderStatus>;
  openNotificationSettings(): Promise<NativeReminderStatus>;
  openExactAlarmSettings(): Promise<NativeReminderStatus>;
  openFullScreenSettings(): Promise<NativeReminderStatus>;
  scheduleTest(): Promise<{exact:boolean}>;
  schedule(options:{id:string;title:string;body:string;at:number}): Promise<{exact:boolean}>;
  cancel(options:{id:string}): Promise<void>;
  getPendingActions(): Promise<{actions:NativeReminderAction[]}>;
  acknowledgeActions(options:{ids:string[]}): Promise<void>;
}

const ReminderAlarm=registerPlugin<ReminderAlarmPlugin>('ReminderAlarm');
const active=(reminder:Reminder)=>reminder.status==='PENDING'||reminder.status==='SNOOZED';

export async function nativeReminderStatus():Promise<NativeReminderStatus|undefined> {
  if(!isNativeAndroid())return undefined;
  return ReminderAlarm.status();
}

/** Android asks once for notifications; exact-alarm access opens its own system screen. */
export async function enableNativeReminders():Promise<NativeReminderStatus|undefined> {
  if(!isNativeAndroid())return undefined;
  const afterNotification=await ReminderAlarm.requestNotificationPermission();
  if(!afterNotification.notifications)await ReminderAlarm.openNotificationSettings();
  else if(!afterNotification.exactAlarms)await ReminderAlarm.openExactAlarmSettings();
  else if(!afterNotification.fullScreen)await ReminderAlarm.openFullScreenSettings();
  return afterNotification;
}

/** Schedules a native alarm 15 seconds ahead so delivery can be tested with the WebView closed. */
export async function testNativeReminder() {
  if(!isNativeAndroid())throw new Error('Системная проверка доступна только в Android APK');
  return ReminderAlarm.scheduleTest();
}

/** Each call replaces only the same id's system alarm. Cancelled/finished items are removed. */
export async function reconcileNativeReminders(reminders:Reminder[]) {
  if(!isNativeAndroid())return;
  await Promise.all(reminders.map(async reminder=>{
    if(!active(reminder))return ReminderAlarm.cancel({id:reminder.id});
    await ReminderAlarm.schedule({id:reminder.id,title:reminder.title,body:reminder.body,at:new Date(reminder.remindAt).getTime()});
  }));
}

/** Native Done/Snooze/Fired actions stay in Android storage until the offline queue records them. */
export async function readNativeReminderActions() {
  if(!isNativeAndroid())return [] as NativeReminderAction[];
  return (await ReminderAlarm.getPendingActions()).actions;
}

export async function acknowledgeNativeReminderActions(ids:string[]) {
  if(isNativeAndroid()&&ids.length)await ReminderAlarm.acknowledgeActions({ids});
}
