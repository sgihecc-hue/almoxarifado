import { serve } from "npm:@supabase/functions-js";
import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Parse the request body first
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (error) {
      console.error("Error parsing request body:", error);
      return new Response(
        JSON.stringify({ 
          error: "Invalid request body",
          details: "Failed to parse JSON body"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { email, full_name, role, password } = requestBody;

    // Validate inputs
    if (!email || !full_name || !role || !password) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (full_name.length < 3) {
      return new Response(
        JSON.stringify({ error: "Full name must be at least 3 characters" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!email.match(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!['solicitante', 'gestor', 'administrador'].includes(role)) {
      return new Response(
        JSON.stringify({ error: "Invalid role" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 8 characters" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("Missing required environment variables");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create admin client with service role
    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Check if email exists in auth.users
    const { data: { users: existingAuthUsers }, error: authCheckError } = await supabaseAdmin.auth.admin.listUsers();
    if (authCheckError) {
      console.error("Error checking existing users:", authCheckError);
      return new Response(
        JSON.stringify({ error: "Failed to check existing users" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (existingAuthUsers.some(user => user.email === email)) {
      return new Response(
        JSON.stringify({ error: "Email already registered" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create the user in auth.users
    const { data: authData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role,
      },
    });

    if (createUserError || !authData.user) {
      console.error("Error creating auth user:", createUserError);
      return new Response(
        JSON.stringify({ error: "Failed to create user" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if profile already exists
    const { data: existingProfile, error: checkProfileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (checkProfileError) {
      console.error("Error checking existing profile:", checkProfileError);
      // Clean up the auth user
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return new Response(
        JSON.stringify({ error: "Failed to check existing profile" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let profile = existingProfile;

    // Create profile only if it doesn't exist
    if (!existingProfile) {
      const { data: newProfile, error: profileCreateError } = await supabaseAdmin
        .from('users')
        .insert([{
          id: authData.user.id,
          email,
          full_name,
          role,
        }])
        .select()
        .single();

      if (profileCreateError) {
        console.error("Error creating user profile:", profileCreateError);
        // Clean up the auth user
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return new Response(
          JSON.stringify({ error: "Failed to create user profile" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      profile = newProfile;
    }

    // Create notification preferences if they don't exist
    const { error: notificationPrefsError } = await supabaseAdmin
      .from('notification_preferences')
      .insert([{
        user_id: authData.user.id,
      }])
      .select()
      .single();

    if (notificationPrefsError && !notificationPrefsError.message.includes('duplicate key')) {
      console.error("Error creating notification preferences:", notificationPrefsError);
      // Don't fail the operation - the trigger will handle this
    }

    return new Response(
      JSON.stringify(profile),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});