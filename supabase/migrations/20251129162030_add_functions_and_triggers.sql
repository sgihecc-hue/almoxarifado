/*
  # Add Functions and Triggers for Hospital Management System

  1. Functions
    - `update_updated_at()` - Automatically update updated_at timestamp
    - `audit_log_changes()` - Audit trail for all changes
    - `handle_new_user()` - Create user profile when auth user is created
    - `ensure_user_notification_preferences()` - Create default notification preferences
    - `approve_request_items()` - Safely approve request items with quantity adjustments

  2. Triggers
    - Update updated_at timestamps on all relevant tables
    - Audit log changes on critical tables
    - Auto-create user profiles and notification preferences
*/

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to audit log changes
CREATE OR REPLACE FUNCTION audit_log_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.audit_logs (
      table_name,
      record_id,
      action,
      new_data,
      changed_by,
      created_at
    ) VALUES (
      TG_TABLE_NAME,
      NEW.id,
      'INSERT',
      to_jsonb(NEW),
      auth.uid(),
      now()
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO public.audit_logs (
      table_name,
      record_id,
      action,
      old_data,
      new_data,
      changed_by,
      created_at
    ) VALUES (
      TG_TABLE_NAME,
      NEW.id,
      'UPDATE',
      to_jsonb(OLD),
      to_jsonb(NEW),
      auth.uid(),
      now()
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO public.audit_logs (
      table_name,
      record_id,
      action,
      old_data,
      changed_by,
      created_at
    ) VALUES (
      TG_TABLE_NAME,
      OLD.id,
      'DELETE',
      to_jsonb(OLD),
      auth.uid(),
      now()
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION handle_new_user() 
RETURNS TRIGGER AS $$
DECLARE
  v_full_name TEXT;
  v_role TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User');
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'solicitante');
  
  INSERT INTO public.users (
    id, 
    email, 
    full_name, 
    role,
    created_at,
    updated_at
  ) VALUES (
    NEW.id, 
    NEW.email,
    v_full_name,
    v_role,
    NOW(),
    NOW()
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    UPDATE public.users
    SET 
      email = NEW.email,
      full_name = v_full_name,
      role = v_role,
      updated_at = NOW()
    WHERE id = NEW.id;
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to ensure notification preferences
CREATE OR REPLACE FUNCTION ensure_user_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_preferences
    WHERE user_id = NEW.id
  ) THEN
    INSERT INTO public.notification_preferences (
      user_id,
      channels,
      types,
      quiet_hours
    ) VALUES (
      NEW.id,
      json_build_object('email', true, 'push', true, 'sms', false, 'in_app', true),
      json_build_object(
        'request_created', true,
        'request_updated', true,
        'request_approved', true,
        'request_rejected', true,
        'request_completed', true,
        'comment_added', true,
        'deadline_approaching', true,
        'low_stock', true,
        'system', true
      ),
      json_build_object('enabled', false, 'start', '22:00', 'end', '06:00')
    );
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'Error in ensure_user_notification_preferences: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to approve request items
CREATE OR REPLACE FUNCTION approve_request_items(
  p_request_id UUID,
  p_approved_quantities JSONB,
  p_approver_id UUID
) RETURNS VOID AS $$
DECLARE
  v_item_id UUID;
  v_approved_quantity INTEGER;
  v_item RECORD;
BEGIN
  UPDATE public.requests
  SET 
    status = 'approved',
    approved_at = NOW(),
    approved_by = p_approver_id
  WHERE id = p_request_id;
  
  FOR v_item_id, v_approved_quantity IN 
    SELECT * FROM jsonb_each_text(p_approved_quantities)
  LOOP
    SELECT * INTO v_item FROM public.request_items WHERE id = v_item_id::UUID;
    
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'Request item % not found', v_item_id;
    END IF;
    
    UPDATE public.request_items
    SET approved_quantity = v_approved_quantity::INTEGER
    WHERE id = v_item_id::UUID;
  END LOOP;
  
  INSERT INTO public.request_status_history (
    request_id, 
    old_status, 
    new_status, 
    changed_by, 
    changed_at
  ) VALUES (
    p_request_id,
    'pending',
    'approved',
    p_approver_id,
    NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_pharmacy_items_updated_at ON public.pharmacy_items;
CREATE TRIGGER update_pharmacy_items_updated_at
  BEFORE UPDATE ON public.pharmacy_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_warehouse_items_updated_at ON public.warehouse_items;
CREATE TRIGGER update_warehouse_items_updated_at
  BEFORE UPDATE ON public.warehouse_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_requests_updated_at ON public.requests;
CREATE TRIGGER update_requests_updated_at
  BEFORE UPDATE ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Create triggers for audit logging
DROP TRIGGER IF EXISTS audit_users_changes ON public.users;
CREATE TRIGGER audit_users_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_changes();

DROP TRIGGER IF EXISTS audit_requests_changes ON public.requests;
CREATE TRIGGER audit_requests_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_changes();

DROP TRIGGER IF EXISTS audit_pharmacy_items_changes ON public.pharmacy_items;
CREATE TRIGGER audit_pharmacy_items_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.pharmacy_items
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_changes();

DROP TRIGGER IF EXISTS audit_warehouse_items_changes ON public.warehouse_items;
CREATE TRIGGER audit_warehouse_items_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.warehouse_items
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_changes();

DROP TRIGGER IF EXISTS audit_consumption_entries_changes ON public.consumption_entries;
CREATE TRIGGER audit_consumption_entries_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.consumption_entries
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_changes();

DROP TRIGGER IF EXISTS audit_warehouse_consumption_entries_changes ON public.warehouse_consumption_entries;
CREATE TRIGGER audit_warehouse_consumption_entries_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.warehouse_consumption_entries
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_changes();

-- Create trigger for auth user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Create trigger for notification preferences
DROP TRIGGER IF EXISTS ensure_user_notification_preferences ON public.users;
CREATE TRIGGER ensure_user_notification_preferences
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION ensure_user_notification_preferences();
