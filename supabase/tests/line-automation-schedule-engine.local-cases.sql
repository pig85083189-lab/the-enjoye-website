-- Local-only Phase 2A schedule apply cases. Never call LINE.

do $$
declare
  v_count int;
  v_status text;
  v_org text;
  v_payload jsonb;
  v_other jsonb;
begin
  perform tests.become('11111111-1111-1111-1111-111111111111');

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'line_automation_jobs'
      and column_name = 'automation_type'
  ) then
    raise exception 'automation_type was not added';
  end if;

  select automation_type, event_id into v_org, v_status
  from public.line_automation_jobs
  where id = 'laj-keep-day';
  if v_org is distinct from 'appointment_reminder' then
    raise exception 'legacy job automation_type not backfilled';
  end if;

  v_payload := jsonb_build_object(
    'organization_id', 'org-the-enjoye',
    'insert', jsonb_build_array(
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'automation_type', 'birthday_greeting',
        'event_kind', 'customer_birthday',
        'event_id', 'cust-1',
        'customer_id', 'cust-1',
        'timing_id', 'birthday_morning',
        'fingerprint', 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning',
        'scheduled_for', (now() + interval '3 day')::text,
        'message_snapshot', '生日快樂',
        'recipient_ready', true
      )
    ),
    'update', '[]'::jsonb,
    'cancel', '[]'::jsonb
  );

  perform public.apply_line_automation_schedule('org-the-enjoye', v_payload);
  perform public.apply_line_automation_schedule('org-the-enjoye', v_payload);

  select count(*) into v_count
  from public.line_automation_jobs
  where organization_id = 'org-the-enjoye'
    and fingerprint = 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning'
    and status in ('scheduled', 'pending_recipient');
  if v_count <> 1 then
    raise exception 'duplicate birthday job created: %', v_count;
  end if;

  v_payload := jsonb_build_object(
    'organization_id', 'org-the-enjoye',
    'insert', '[]'::jsonb,
    'update', '[]'::jsonb,
    'cancel', jsonb_build_array(
      jsonb_build_object(
        'id', 'laj-keep-day',
        'organization_id', 'org-the-enjoye',
        'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning'
      ),
      jsonb_build_object(
        'id', 'laj-accepted',
        'organization_id', 'org-the-enjoye',
        'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|hours_before_3'
      )
    )
  );
  perform public.apply_line_automation_schedule('org-the-enjoye', v_payload);

  select status into v_status from public.line_automation_jobs where id = 'laj-keep-day';
  if v_status is distinct from 'canceled' then
    raise exception 'scheduled job was not canceled: %', v_status;
  end if;
  select status into v_status from public.line_automation_jobs where id = 'laj-accepted';
  if v_status is distinct from 'accepted' then
    raise exception 'accepted job was mutated: %', v_status;
  end if;

  v_payload := jsonb_build_object(
    'organization_id', 'org-the-enjoye',
    'insert', jsonb_build_array(
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'automation_type', 'appointment_reminder',
        'event_kind', 'appointment',
        'event_id', 'appt-keep',
        'customer_id', 'cust-1',
        'timing_id', 'hours_before_3',
        'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|hours_before_3',
        'scheduled_for', (now() + interval '5 hour')::text,
        'message_snapshot', '預約提醒',
        'recipient_ready', true
      )
    ),
    'update', '[]'::jsonb,
    'cancel', '[]'::jsonb
  );
  perform public.apply_line_automation_schedule('org-the-enjoye', v_payload);
  select count(*) into v_count
  from public.line_automation_jobs
  where fingerprint = 'org-the-enjoye|appointment_reminder|appt-keep|hours_before_3'
    and status in ('scheduled', 'pending_recipient');
  if v_count <> 0 then
    raise exception 'accepted job was resent';
  end if;

  begin
    v_other := jsonb_build_object(
      'organization_id', 'org-lumiere',
      'insert', jsonb_build_array(
        jsonb_build_object(
          'organization_id', 'org-lumiere',
          'automation_type', 'birthday_greeting',
          'event_kind', 'customer_birthday',
          'event_id', 'cust-l',
          'customer_id', 'cust-l',
          'timing_id', 'birthday_morning',
          'fingerprint', 'org-lumiere|birthday_greeting|cust-l|birthday_morning',
          'scheduled_for', (now() + interval '2 day')::text,
          'message_snapshot', 'other org',
          'recipient_ready', false
        )
      ),
      'update', '[]'::jsonb,
      'cancel', '[]'::jsonb
    );
    perform public.apply_line_automation_schedule('org-lumiere', v_other);
    raise exception 'cross-org apply was allowed';
  exception
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm not ilike '%unauthorized%' then
        raise;
      end if;
  end;

  perform tests.become('22222222-2222-2222-2222-222222222222');
  perform public.apply_line_automation_schedule('org-lumiere', v_other);

  select count(*) into v_count
  from public.line_automation_jobs
  where organization_id = 'org-lumiere';
  if v_count <> 1 then
    raise exception 'lumiere job count %', v_count;
  end if;

  select status into v_status
  from public.line_automation_jobs
  where organization_id = 'org-lumiere';
  if v_status is distinct from 'pending_recipient' then
    raise exception 'missing recipient should stay pending: %', v_status;
  end if;

  if exists (
    select 1
    from public.line_automation_jobs
    where organization_id = 'org-lumiere'
      and organization_id = 'org-the-enjoye'
  ) then
    raise exception 'jobs leaked across organizations';
  end if;

  perform tests.become('11111111-1111-1111-1111-111111111111');
  if exists (
    select 1
    from jsonb_array_elements(public.read_line_automation_schedule('org-the-enjoye')->'jobs') j
    where j->>'organization_id' is distinct from 'org-the-enjoye'
  ) then
    raise exception 'read leaked another organization';
  end if;

  begin
    perform public.apply_line_automation_schedule(
      'org-the-enjoye',
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'insert', jsonb_build_array(
          jsonb_build_object(
            'organization_id', 'org-the-enjoye',
            'automation_type', 'birthday_greeting',
            'event_kind', 'customer_birthday',
            'event_id', 'cust-1',
            'customer_id', 'cust-1',
            'timing_id', 'birthday_morning',
            'fingerprint', 'forged-fingerprint',
            'scheduled_for', (now() + interval '3 day')::text,
            'message_snapshot', '生日快樂',
            'recipient_ready', true
          )
        ),
        'update', '[]'::jsonb,
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'forged fingerprint was accepted';
  exception
    when others then
      if sqlerrm not ilike '%invalid fingerprint%' then
        raise;
      end if;
  end;

  begin
    perform public.apply_line_automation_schedule(
      'org-the-enjoye',
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'insert', jsonb_build_array(
          jsonb_build_object(
            'organization_id', 'org-the-enjoye',
            'automation_type', 'birthday_greeting',
            'event_kind', 'customer_birthday',
            'event_id', 'cust-l',
            'customer_id', 'cust-l',
            'timing_id', 'birthday_morning',
            'fingerprint', 'org-the-enjoye|birthday_greeting|cust-l|birthday_morning',
            'scheduled_for', (now() + interval '3 day')::text,
            'message_snapshot', '生日快樂',
            'recipient_ready', true
          )
        ),
        'update', '[]'::jsonb,
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'cross-org customer was accepted';
  exception
    when others then
      if sqlerrm not ilike '%invalid customer%' then
        raise;
      end if;
  end;

  begin
    perform public.apply_line_automation_schedule(
      'org-the-enjoye',
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'insert', jsonb_build_array(
          jsonb_build_object(
            'organization_id', 'org-the-enjoye',
            'automation_type', 'holiday_greeting',
            'event_kind', 'holiday_occurrence',
            'event_id', 'xmas:cust-1',
            'customer_id', 'cust-1',
            'timing_id', 'christmas',
            'fingerprint', 'org-the-enjoye|holiday_greeting|xmas:cust-1|christmas',
            'scheduled_for', (now() + interval '30 day')::text,
            'message_snapshot', '節日',
            'recipient_ready', true
          )
        ),
        'update', '[]'::jsonb,
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'holiday job without official source was accepted';
  exception
    when others then
      if sqlerrm not ilike '%holiday source missing%' then
        raise;
      end if;
  end;

  begin
    perform public.apply_line_automation_schedule(
      'org-the-enjoye',
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'insert', jsonb_build_array(
          jsonb_build_object(
            'organization_id', 'org-the-enjoye',
            'automation_type', 'satisfaction_survey',
            'event_kind', 'treatment',
            'event_id', 'trt-1',
            'customer_id', 'cust-1',
            'timing_id', 'hours_after_2',
            'fingerprint', 'org-the-enjoye|satisfaction_survey|trt-1|hours_after_2',
            'scheduled_for', (now() + interval '2 hour')::text,
            'message_snapshot', '問卷',
            'recipient_ready', true
          )
        ),
        'update', '[]'::jsonb,
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'missing survey rule was accepted';
  exception
    when others then
      if sqlerrm not ilike '%missing rule%' and sqlerrm not ilike '%invalid event%' then
        raise;
      end if;
  end;

  begin
    perform public.apply_line_automation_schedule(
      'org-the-enjoye',
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'insert', jsonb_build_array(
          jsonb_build_object(
            'organization_id', 'org-the-enjoye',
            'automation_type', 'appointment_reminder',
            'event_kind', 'appointment',
            'event_id', 'appt-keep',
            'customer_id', 'cust-1',
            'timing_id', 'day_before_morning',
            'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning',
            'scheduled_for', (now() + interval '1 day')::text,
            'message_snapshot', '預約提醒',
            'recipient_ready', true,
            'status', 'accepted'
          )
        ),
        'update', '[]'::jsonb,
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'accepted status insert was accepted';
  exception
    when others then
      if sqlerrm not ilike '%invalid status%' then
        raise;
      end if;
  end;

  perform public.apply_line_automation_schedule(
    'org-the-enjoye',
    jsonb_build_object(
      'organization_id', 'org-the-enjoye',
      'insert', '[]'::jsonb,
      'update', jsonb_build_array(
        jsonb_build_object(
          'id', 'laj-claimed',
          'organization_id', 'org-the-enjoye',
          'automation_type', 'appointment_reminder',
          'event_kind', 'appointment',
          'event_id', 'appt-keep',
          'customer_id', 'cust-1',
          'timing_id', 'day_before_morning',
          'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning',
          'scheduled_for', (now() + interval '8 hour')::text,
          'message_snapshot', '預約提醒',
          'recipient_ready', true
        )
      ),
      'cancel', jsonb_build_array(
        jsonb_build_object(
          'id', 'laj-claimed',
          'organization_id', 'org-the-enjoye',
          'fingerprint', 'org-the-enjoye|appointment_reminder|appt-claimed|day_before_morning'
        ),
        jsonb_build_object(
          'id', 'laj-pending-confirm',
          'organization_id', 'org-the-enjoye',
          'fingerprint', 'org-the-enjoye|appointment_reminder|appt-confirm|hours_before_3'
        ),
        jsonb_build_object(
          'id', 'laj-reconciled',
          'organization_id', 'org-the-enjoye',
          'fingerprint', 'org-the-enjoye|appointment_reminder|appt-reconciled|day_before_morning'
        )
      )
    )
  );

  select status into v_status from public.line_automation_jobs where id = 'laj-claimed';
  if v_status is distinct from 'claimed' then
    raise exception 'claimed job was mutated: %', v_status;
  end if;
  select status into v_status from public.line_automation_jobs where id = 'laj-pending-confirm';
  if v_status is distinct from 'pending_confirmation' then
    raise exception 'pending_confirmation job was mutated: %', v_status;
  end if;
  select status into v_status from public.line_automation_jobs where id = 'laj-reconciled';
  if v_status is distinct from 'reconciled' then
    raise exception 'reconciled job was mutated: %', v_status;
  end if;

  select count(*) into v_count
  from public.line_automation_jobs
  where organization_id = 'org-the-enjoye'
    and fingerprint = 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning';
  if v_count <> 1 then
    raise exception 'partial apply lost birthday job: %', v_count;
  end if;
end $$;
