# Supabase Reference: Realtime and Storage

## Realtime

Add tables to the realtime publication before expecting change events.

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

Realtime respects `SELECT` policy visibility.

### Subscription Example

```typescript
const channel = supabase
  .channel('user-orders')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: `user_id=eq.${userId}`,
    },
    (payload) => {
      console.log('Change received:', payload);
    },
  )
  .subscribe();

return () => {
  supabase.removeChannel(channel);
};
```

### Presence Example

```typescript
const channel = supabase.channel('room-1');

channel
  .on('presence', { event: 'sync' }, () => {
    console.log(channel.presenceState());
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ user_id: userId, online_at: new Date().toISOString() });
    }
  });
```

## Storage

Create buckets, then control access through `storage.objects` policies.

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false);
```

### Storage Policies

```sql
CREATE POLICY "users_upload_own_avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "public_read_avatars"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'avatars');

CREATE POLICY "users_delete_own_avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
```

### Upload and Download

```typescript
const uploadResult = await supabase.storage
  .from('avatars')
  .upload(`${userId}/avatar.jpg`, file, {
    contentType: 'image/jpeg',
    upsert: true,
  });

const { data: publicUrlData } = supabase.storage
  .from('avatars')
  .getPublicUrl(`${userId}/avatar.jpg`);

const { data: signedUrlData } = await supabase.storage
  .from('documents')
  .createSignedUrl(`${userId}/report.pdf`, 3600);
```

## Hard Rules

- Do not expect realtime events without publication setup.
- Do not debug realtime without checking `SELECT` policies first.
- Do not assume public buckets remove the need for upload, update, or delete policies.
