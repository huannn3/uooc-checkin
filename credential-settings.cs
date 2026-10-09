using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Windows.Forms;
using System.Drawing;

class CredentialSettings {
    [STAThread]
    static void Main() {
        Application.EnableVisualStyles();
        string file = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".uooc-login.dat");
        using (var form = new Form { Text = "Uooc 登录账号设置", ClientSize = new Size(460, 245), StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, Font = new Font("Microsoft YaHei UI", 10) }) {
            var info = new Label { Text = "仅在本机当前 Windows 账户下加密保存。登录时自动填写并尝试点击验证框一次，未通过时需手动完成。", Left = 20, Top = 12, Width = 420, Height = 46 };
            var accountLabel = new Label { Text = "手机号 / 邮箱", Left = 20, Top = 70, Width = 110 };
            var account = new TextBox { Left = 140, Top = 66, Width = 300 };
            var passwordLabel = new Label { Text = "密码", Left = 20, Top = 112, Width = 110 };
            var password = new TextBox { Left = 140, Top = 108, Width = 300, UseSystemPasswordChar = true };
            var status = new Label { Text = File.Exists(file) ? "已保存账号；更新时请重新填写账号和密码。" : "输入账号密码后点击保存。", Left = 20, Top = 151, Width = 420, Height = 28 };
            var save = new Button { Text = "保存并启用", Left = 140, Top = 193, Width = 140, Height = 32 };
            var clear = new Button { Text = "清除已存账号", Left = 290, Top = 193, Width = 150, Height = 32 };
            save.Click += (sender, args) => {
                if (String.IsNullOrWhiteSpace(account.Text) || password.Text.Length == 0) { MessageBox.Show(form, "请填写账号和密码。", "未保存"); return; }
                byte[] plain = Encoding.UTF8.GetBytes("{\"account\":\"" + Escape(account.Text.Trim()) + "\",\"password\":\"" + Escape(password.Text) + "\"}");
                try {
                    byte[] encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
                    File.WriteAllText(file, Convert.ToBase64String(encrypted), new UTF8Encoding(false));
                    password.Clear(); form.Close();
                } catch { MessageBox.Show(form, "保存失败，请检查目录是否可写。", "未保存"); }
                finally { Array.Clear(plain, 0, plain.Length); }
            };
            clear.Click += (sender, args) => {
                try { if (File.Exists(file)) File.Delete(file); account.Clear(); password.Clear(); status.Text = "已清除；现有登录会话和课程保持不变。"; }
                catch { MessageBox.Show(form, "清除失败，请检查目录是否可写。", "未清除"); }
            };
            form.Controls.AddRange(new Control[] { info, accountLabel, account, passwordLabel, password, status, save, clear });
            Application.Run(form);
            password.Clear();
        }
    }
    static string Escape(string value) {
        var escaped = new StringBuilder();
        foreach (char c in value) {
            if (c == '"' || c == '\\') escaped.Append('\\').Append(c);
            else if (c < 32) escaped.Append("\\u").Append(((int)c).ToString("x4"));
            else escaped.Append(c);
        }
        return escaped.ToString();
    }
}
