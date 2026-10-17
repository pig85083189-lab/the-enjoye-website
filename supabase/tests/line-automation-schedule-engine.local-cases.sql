-- Local-only Phase 2A schedule apply cases. Never call LINE.

do $$
declare
  v_count int;
  v_status text;
  v_org text;
  v_payload jsonb;
  v_other jsonb;
  v_ready boolean;
  v_app_id text;
  v_type text;
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
  if not exists (
    select 1
    from public.line_automation_jobs
    where id = 'laj-keep-day'
      and organization_id = 'org-the-enjoye'
      and appointment_app_id = 'appt-keep'
      and customer_app_id = 'cust-1'
      and timing_id = 'day_before_morning'
      and fingerprint = 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning'
      and status = 'scheduled'
      and recipient_ready is false
  ) then
    raise exception 'Phase 2B appointment job was not preserved by re-runnable upgrade';
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
        'scheduled_for', public.line_automation_schedule_expected_fire_at(
          'org-the-enjoye', 'birthday_greeting', 'customer_birthday', 'cust-1', 'cust-1', 'birthday_morning'
        ),
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

  begin
    perform public.apply_line_automation_schedule(
      'org-the-enjoye',
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'insert', '[]'::jsonb,
        'update', '[]'::jsonb,
        'cancel', jsonb_build_array(
          jsonb_build_object(
            'id', 'laj-keep-day',
            'organization_id', 'org-the-enjoye',
            'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning'
          )
        )
      )
    );
    raise exception 'arbitrary cancel of a valid schedule was accepted';
  exception
    when others then
      if sqlerrm not ilike '%cancel not allowed%' then
        raise;
      end if;
  end;

  select status into v_status from public.line_automation_jobs where id = 'laj-keep-day';
  if v_status is distinct from 'scheduled' then
    raise exception 'valid Phase 2B job was canceled: %', v_status;
  end if;

  perform public.apply_line_automation_schedule(
    'org-the-enjoye',
    jsonb_build_object(
      'organization_id', 'org-the-enjoye',
      'insert', '[]'::jsonb,
      'update', '[]'::jsonb,
      'cancel', jsonb_build_array(
        jsonb_build_object(
          'id', 'laj-accepted',
          'organization_id', 'org-the-enjoye',
          'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|hours_before_3'
        )
      )
    )
  );
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
        'scheduled_for', public.line_automation_schedule_expected_fire_at(
          'org-the-enjoye', 'appointment_reminder', 'appointment', 'appt-keep', 'cust-1', 'hours_before_3'
        ),
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
          'scheduled_for', public.line_automation_schedule_expected_fire_at(
            'org-lumiere', 'birthday_greeting', 'customer_birthday', 'cust-l', 'cust-l', 'birthday_morning'
          ),
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
            'scheduled_for', public.line_automation_schedule_expected_fire_at(
              'org-the-enjoye', 'appointment_reminder', 'appointment', 'appt-keep', 'cust-1', 'day_before_morning'
            ),
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
          'scheduled_for', public.line_automation_schedule_expected_fire_at(
            'org-the-enjoye', 'appointment_reminder', 'appointment', 'appt-keep', 'cust-1', 'day_before_morning'
          ),
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

  insert into public.line_automation_rules (
    organization_id, automation_type, enabled, timing_ids, timing_config, message_template
  ) values
    (
      'org-the-enjoye', 'satisfaction_survey', true,
      array['hours_after_2']::text[],
      '{"selectedTimingIds":["hours_after_2"],"customTimings":[]}'::jsonb,
      '問卷'
    ),
    (
      'org-the-enjoye', 'coupon_expiry', true,
      array['days_before_7']::text[],
      '{"selectedTimingIds":["days_before_7"],"customTimings":[]}'::jsonb,
      '套票到期'
    );

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
            'customer_id', 'cust-2',
            'timing_id', 'hours_after_2',
            'fingerprint', 'org-the-enjoye|satisfaction_survey|trt-1|hours_after_2',
            'scheduled_for', public.line_automation_schedule_expected_fire_at(
              'org-the-enjoye', 'satisfaction_survey', 'treatment', 'trt-1', 'cust-1', 'hours_after_2'
            ),
            'message_snapshot', '問卷',
            'recipient_ready', true
          )
        ),
        'update', '[]'::jsonb,
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'same-org customer event mismatch was accepted';
  exception
    when others then
      if sqlerrm not ilike '%invalid event%' then
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
            'automation_type', 'coupon_expiry',
            'event_kind', 'customer_package',
            'event_id', 'pkg-1',
            'customer_id', 'cust-2',
            'timing_id', 'days_before_7',
            'fingerprint', 'org-the-enjoye|coupon_expiry|pkg-1|days_before_7',
            'scheduled_for', public.line_automation_schedule_expected_fire_at(
              'org-the-enjoye', 'coupon_expiry', 'customer_package', 'pkg-1', 'cust-1', 'days_before_7'
            ),
            'message_snapshot', '套票到期',
            'recipient_ready', true
          )
        ),
        'update', '[]'::jsonb,
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'same-org package customer mismatch was accepted';
  exception
    when others then
      if sqlerrm not ilike '%invalid event%' then
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
            'event_id', 'cust-1',
            'customer_id', 'cust-1',
            'timing_id', 'birthday_morning',
            'fingerprint', 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning',
            'scheduled_for', (now() + interval '9 day')::text,
            'message_snapshot', '生日快樂',
            'recipient_ready', true
          )
        ),
        'update', '[]'::jsonb,
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'forged scheduled_for was accepted';
  exception
    when others then
      if sqlerrm not ilike '%invalid scheduled_for%' then
        raise;
      end if;
  end;

  perform public.apply_line_automation_schedule(
    'org-the-enjoye',
    jsonb_build_object(
      'organization_id', 'org-the-enjoye',
      'insert', jsonb_build_array(
        jsonb_build_object(
          'organization_id', 'org-the-enjoye',
          'automation_type', 'birthday_greeting',
          'event_kind', 'customer_birthday',
          'event_id', 'cust-2',
          'customer_id', 'cust-2',
          'timing_id', 'birthday_morning',
          'fingerprint', 'org-the-enjoye|birthday_greeting|cust-2|birthday_morning',
          'scheduled_for', public.line_automation_schedule_expected_fire_at(
            'org-the-enjoye', 'birthday_greeting', 'customer_birthday', 'cust-2', 'cust-2', 'birthday_morning'
          ),
          'message_snapshot', '生日快樂',
          'recipient_ready', true
        )
      ),
      'update', '[]'::jsonb,
      'cancel', '[]'::jsonb
    )
  );

  select status, recipient_ready into v_status, v_ready
  from public.line_automation_jobs
  where fingerprint = 'org-the-enjoye|birthday_greeting|cust-2|birthday_morning'
    and status in ('scheduled', 'pending_recipient');
  if v_status is distinct from 'pending_recipient' or v_ready is not false then
    raise exception 'forged recipient_ready was accepted: % %', v_status, v_ready;
  end if;

  begin
    perform public.apply_line_automation_schedule(
      'org-the-enjoye',
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'insert', '[]'::jsonb,
        'update', jsonb_build_array(
          jsonb_build_object(
            'id', 'laj-keep-day',
            'organization_id', 'org-the-enjoye',
            'automation_type', 'appointment_reminder',
            'event_kind', 'appointment',
            'event_id', 'appt-other',
            'customer_id', 'cust-1',
            'timing_id', 'day_before_morning',
            'fingerprint', 'org-the-enjoye|appointment_reminder|appt-other|day_before_morning',
            'scheduled_for', public.line_automation_schedule_expected_fire_at(
              'org-the-enjoye', 'appointment_reminder', 'appointment', 'appt-other', 'cust-1', 'day_before_morning'
            ),
            'message_snapshot', '預約提醒',
            'recipient_ready', true
          )
        ),
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'update event/customer/fingerprint swap was accepted';
  exception
    when others then
      if sqlerrm not ilike '%job identity mismatch%' then
        raise;
      end if;
  end;

  begin
    perform public.apply_line_automation_schedule(
      'org-the-enjoye',
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'insert', '[]'::jsonb,
        'update', jsonb_build_array(
          jsonb_build_object(
            'id', 'laj-keep-day',
            'organization_id', 'org-the-enjoye',
            'automation_type', 'appointment_reminder',
            'event_kind', 'appointment',
            'event_id', 'appt-keep',
            'customer_id', 'cust-2',
            'timing_id', 'day_before_morning',
            'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning',
            'scheduled_for', public.line_automation_schedule_expected_fire_at(
              'org-the-enjoye', 'appointment_reminder', 'appointment', 'appt-keep', 'cust-1', 'day_before_morning'
            ),
            'message_snapshot', '預約提醒',
            'recipient_ready', true
          )
        ),
        'cancel', '[]'::jsonb
      )
    );
    raise exception 'update customer swap was accepted';
  exception
    when others then
      if sqlerrm not ilike '%job identity mismatch%' then
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
          'id', 'laj-keep-day',
          'organization_id', 'org-the-enjoye',
          'automation_type', 'appointment_reminder',
          'event_kind', 'appointment',
          'event_id', 'appt-keep',
          'customer_id', 'cust-1',
          'timing_id', 'day_before_morning',
          'fingerprint', 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning',
          'scheduled_for', public.line_automation_schedule_expected_fire_at(
            'org-the-enjoye', 'appointment_reminder', 'appointment', 'appt-keep', 'cust-1', 'day_before_morning'
          ),
          'message_snapshot', '預約提醒',
          'recipient_ready', true
        )
      ),
      'cancel', '[]'::jsonb
    )
  );

  select status, appointment_app_id, automation_type, recipient_ready
  into v_status, v_app_id, v_type, v_ready
  from public.line_automation_jobs
  where id = 'laj-keep-day';
  if v_status is distinct from 'scheduled' then
    raise exception 'Phase 2B appointment job lost scheduled status: %', v_status;
  end if;
  if v_app_id is distinct from 'appt-keep' then
    raise exception 'Phase 2B appointment_app_id changed: %', v_app_id;
  end if;
  if v_type is distinct from 'appointment_reminder' then
    raise exception 'Phase 2B automation_type changed: %', v_type;
  end if;
  if v_ready is not false then
    raise exception 'Phase 2B recipient_ready was forged: %', v_ready;
  end if;
  if not exists (
    select 1
    from public.line_automation_jobs
    where id = 'laj-keep-day'
      and event_id = 'appt-keep'
      and customer_id = 'cust-1'
      and fingerprint = 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning'
      and timing_id = 'day_before_morning'
      and scheduled_for = public.line_automation_schedule_expected_fire_at(
        'org-the-enjoye', 'appointment_reminder', 'appointment', 'appt-keep', 'cust-1', 'day_before_morning'
      )
      and recipient_ready is false
      and status = 'scheduled'
  ) then
    raise exception 'Phase 2B appointment job lost original identity or safe status';
  end if;
end $$;
