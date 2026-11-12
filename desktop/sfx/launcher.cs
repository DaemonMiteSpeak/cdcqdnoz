// Hider portable launcher (compiled with the .NET Framework csc that ships with Windows).
// File layout:  [this launcher][7za.exe][payload.7z][random padding (optional)][FOOTER 64 bytes]
// FOOTER: "HDRSFX01" | i64 sevenZipOffset | i64 sevenZipLen | i64 payloadOffset | i64 payloadLen | 16-byte payload id | zero pad
// The payload is unpacked once into %LOCALAPPDATA%\Hider\app-<id>; later launches start Hider.exe directly.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Launcher
{
    const int FooterLen = 64;

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            string self = Process.GetCurrentProcess().MainModule.FileName;
            long sevOff, sevLen, payOff, payLen; string id;
            using (FileStream fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                if (fs.Length < FooterLen) return Fail("Corrupted file.");
                byte[] f = new byte[FooterLen];
                fs.Seek(-FooterLen, SeekOrigin.End);
                fs.Read(f, 0, FooterLen);
                if (Encoding.ASCII.GetString(f, 0, 8) != "HDRSFX01") return Fail("Corrupted file.");
                sevOff = BitConverter.ToInt64(f, 8); sevLen = BitConverter.ToInt64(f, 16);
                payOff = BitConverter.ToInt64(f, 24); payLen = BitConverter.ToInt64(f, 32);
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < 16; i++) sb.Append(f[40 + i].ToString("x2"));
                id = sb.ToString();
            }

            string baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Hider");
            string root = Path.Combine(baseDir, "app-" + id);
            string exe = Path.Combine(root, "Hider.exe");
            string ok = Path.Combine(root, ".ok");

            if (!File.Exists(ok))
            {
                bool created;
                using (Mutex mx = new Mutex(false, "Local\\HiderSfx-" + id))
                {
                    mx.WaitOne();
                    try
                    {
                        if (!File.Exists(ok)) Extract(self, sevOff, sevLen, payOff, payLen, baseDir, root, ok);
                    }
                    finally { mx.ReleaseMutex(); }
                    created = true;
                }
                if (!created) return 1;
                Cleanup(baseDir, "app-" + id);
            }

            ProcessStartInfo psi = new ProcessStartInfo(exe);
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            StringBuilder a = new StringBuilder();
            foreach (string s in args) { if (a.Length > 0) a.Append(' '); a.Append('"').Append(s.Replace("\"", "\\\"")).Append('"'); }
            psi.Arguments = a.ToString();
            Process.Start(psi);
            return 0;
        }
        catch (Exception e)
        {
            return Fail(e.Message);
        }
    }

    static int Fail(string msg)
    {
        MessageBox.Show("Hider could not start: " + msg, "Hider", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }

    static void CopyRange(string src, long off, long len, string dst)
    {
        using (FileStream i = new FileStream(src, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        using (FileStream o = new FileStream(dst, FileMode.Create, FileAccess.Write))
        {
            i.Seek(off, SeekOrigin.Begin);
            byte[] buf = new byte[1 << 20];
            long left = len;
            while (left > 0)
            {
                int n = i.Read(buf, 0, (int)Math.Min(buf.Length, left));
                if (n <= 0) throw new IOException("Unexpected end of file.");
                o.Write(buf, 0, n);
                left -= n;
            }
        }
    }

    static void Extract(string self, long sevOff, long sevLen, long payOff, long payLen, string baseDir, string root, string ok)
    {
        Directory.CreateDirectory(baseDir);
        string tmp = Path.Combine(Path.GetTempPath(), "hider-sfx-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        string stage = root + ".tmp";
        Exception error = null;

        Form form = new Form();
        form.FormBorderStyle = FormBorderStyle.None;
        form.StartPosition = FormStartPosition.CenterScreen;
        form.ClientSize = new Size(340, 84);
        form.BackColor = Color.FromArgb(17, 17, 17);
        form.ShowInTaskbar = true;
        form.Text = "Hider";
        form.TopMost = true;
        Label title = new Label();
        title.Text = "Hider";
        title.ForeColor = Color.White;
        title.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
        title.SetBounds(18, 12, 300, 24);
        Label sub = new Label();
        sub.Text = "First launch: preparing files\u2026";
        sub.ForeColor = Color.FromArgb(150, 150, 150);
        sub.Font = new Font("Segoe UI", 9f);
        sub.SetBounds(18, 38, 300, 18);
        ProgressBar pb = new ProgressBar();
        pb.Style = ProgressBarStyle.Marquee;
        pb.MarqueeAnimationSpeed = 25;
        pb.SetBounds(18, 62, 304, 6);
        form.Controls.Add(title); form.Controls.Add(sub); form.Controls.Add(pb);
        form.Paint += delegate (object s, PaintEventArgs e) { e.Graphics.DrawRectangle(new Pen(Color.FromArgb(60, 60, 60)), 0, 0, form.Width - 1, form.Height - 1); };

        Thread worker = new Thread(delegate ()
        {
            try
            {
                Directory.CreateDirectory(tmp);
                string sev = Path.Combine(tmp, "7za.exe");
                string pay = Path.Combine(tmp, "payload.7z");
                CopyRange(self, sevOff, sevLen, sev);
                CopyRange(self, payOff, payLen, pay);
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
                ProcessStartInfo psi = new ProcessStartInfo(sev, "x -y -mmt=on -bd \"-o" + stage + "\" \"" + pay + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit();
                    if (p.ExitCode != 0) throw new IOException("Unpack failed (code " + p.ExitCode + ").");
                }
                if (Directory.Exists(root)) Directory.Delete(root, true);
                Directory.Move(stage, root);
                File.WriteAllText(ok, "1");
            }
            catch (Exception e) { error = e; }
            finally
            {
                try { Directory.Delete(tmp, true); } catch { }
                try { form.BeginInvoke((MethodInvoker)delegate { form.Close(); }); } catch { }
            }
        });
        worker.IsBackground = true;
        worker.Start();
        Application.EnableVisualStyles();
        // show the window only if unpacking takes noticeable time
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
        t.Interval = 600;
        t.Tick += delegate { t.Stop(); if (worker.IsAlive) form.Opacity = 1; };
        form.Opacity = 0;
        form.Shown += delegate { t.Start(); };
        Application.Run(form);
        worker.Join();
        if (error != null) throw error;
    }

    static void Cleanup(string baseDir, string keep)
    {
        try
        {
            foreach (string d in Directory.GetDirectories(baseDir, "app-*"))
            {
                if (Path.GetFileName(d) == keep) continue;
                try { Directory.Delete(d, true); } catch { }
            }
        }
        catch { }
    }
}
