import { type PluginButtonContentProps, type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { accessSettings, parseAccess } from "../shared/contracts";

/** Header popover: email PIN on/off and extra emails or *@domain rules for one workspace. */
export function WorkspaceAccess({ workspaceId, theme, close }: PluginButtonContentProps) {
  const settings = useSettings(accessSettings);
  const [text, setText] = useState<string | null>(null);
  const [pin, setPin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (settings.status !== "ready")
    return <Text style={{ color: theme.colors.foregroundMuted, padding: 12 }}>{settings.status === "loading" ? "Loading…" : settings.error}</Text>;
  const { values, revision } = settings;
  const value = text ?? (values.workspaces[workspaceId] ?? []).join(", ");
  const required = pin ?? !values.publicWorkspaces.includes(workspaceId);
  async function save() {
    let extra: string[];
    try { extra = parseAccess(value); } catch (problem) { return setError((problem as Error).message); }
    const workspaces = { ...values.workspaces, [workspaceId]: extra };
    if (!extra.length) delete workspaces[workspaceId];
    const publicWorkspaces = values.publicWorkspaces.filter(id => id !== workspaceId).concat(required ? [] : [workspaceId]);
    if (await settings.save({ ...values, workspaces, publicWorkspaces }, revision)) close();
  }
  const button = { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 };
  return (
    <View style={{ padding: 12, gap: 8, minWidth: 300 }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: required }} onPress={() => setPin(!required)}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: theme.colors.border,
          backgroundColor: required ? theme.colors.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
          {required ? <Text style={{ color: theme.colors.accentForeground, fontSize: 11, lineHeight: 14 }}>✓</Text> : null}
        </View>
        <Text style={{ color: theme.colors.foreground }}>Require email PIN</Text>
      </Pressable>
      {required ? null : <Text style={{ color: theme.colors.statusWarning }}>
        Public link: anyone who has the link can open this service, without a PIN.
      </Text>}
      <Text style={{ color: theme.colors.foregroundMuted }}>
        Always allowed: {values.alwaysAllowed.join(", ") || "nobody (set it in plugin settings)"}
      </Text>
      <Text style={{ color: theme.colors.foreground }}>Extra emails or *@domains for this workspace</Text>
      <TextInput value={value} onChangeText={setText} autoCapitalize="none" autoCorrect={false} autoFocus
        accessibilityLabel="Extra emails or domains, comma-separated" placeholder="*@customer.com, jane@partner.com"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{ color: theme.colors.foreground, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, padding: 8 }} />
      <Text style={{ color: theme.colors.foregroundMuted }}>Saving while a link is active replaces it with a new link.</Text>
      {error ?? settings.saveError ? <Text style={{ color: theme.colors.statusDanger }}>{error ?? settings.saveError}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={close} style={button}>
          <Text style={{ color: theme.colors.foreground }}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={settings.saving} onPress={save}
          style={{ ...button, backgroundColor: theme.colors.accent }}>
          <Text style={{ color: theme.colors.accentForeground }}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Settings → Plugins: the base list every workspace gets. Saved explicitly, because each save restarts active links. */
export function AlwaysAllowed(_: PluginSurfaceProps) {
  const settings = useSettings(accessSettings);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (settings.status !== "ready") return null;
  const { values, revision } = settings;
  async function save() {
    let alwaysAllowed: string[];
    try { alwaysAllowed = parseAccess(text ?? values.alwaysAllowed.join(",")); } catch (problem) { return setError((problem as Error).message); }
    setError(null);
    if (await settings.save({ ...values, alwaysAllowed }, revision)) setText(null);
  }
  return (
    <SettingsSection title="Access">
      <SettingsInput label="Always allowed" initialValue={values.alwaysAllowed.join(", ")} onChangeText={setText}
        hint="Comma-separated emails or *@domain rules that may open every public link. Visitors confirm their address with a one-time PIN."
        placeholder="*@yourcompany.com" error={error ?? settings.saveError} />
      <SettingsAction label="Apply" hint="Active links restart with a new address." actionLabel="Save"
        disabled={text === null || settings.saving} onPress={save} />
    </SettingsSection>
  );
}
