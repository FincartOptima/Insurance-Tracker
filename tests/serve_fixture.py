import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_renewals import Connection, policy
import queries
import app
from datetime import timedelta

names=['Aarav Mehta','Priya Sharma','Rohan Kapoor','Neha Gupta','Vikram Shah','Ananya Rao','Ishaan Verma','Kavya Nair']
plans=[('Care Health Insurance','Care Supreme','Health',24500),('HDFC Life','Click 2 Protect','Life',18750),('ICICI Lombard','Complete Health','Health',32800),('Star Health','Family Health Optima','Health',21900)]
rows=[]
for i in range(70):
    days=[0,1,3,5,7,10,15,28,45,60,90,-5,None][i%13]
    insurer,plan,kind,premium=plans[i%4]
    r=policy(f'FC/2026/{i+1:04}',days,client_name=names[i%8],client_email=f'client{i+1}@example.com',phone=f'98000{i+1:05}',policy_partner=insurer,policy=plan,insurance_type=kind,premium_amount=premium,rm_name=['Riya Sen','Arjun Das','Meera Shah'][i%3],team=['East','West'][i%2],status='Done' if i%7==0 else 'Not Done')
    r['next_premium_date']=queries.business_today()+timedelta(days=days) if days is not None else None
    rows.append(r)
class DemoConnection(Connection):
    def execute(self,sql,params=None):
        super().execute(sql,params)
        if sql.startswith('UPDATE'):
            self.rowcount=0
            field=sql.split('SET ')[1].split(' =')[0]
            for r in self.rows:
                if r['policy_no']==params[1]:
                    r[field]=params[0]
                    self.rowcount=1
                    if field=='next_premium_date':r['rescheduled_at']='demo'
app.db.connect=lambda: DemoConnection(rows)
app.db.init_db=lambda:None
app.db.get_meta=lambda *args:None
app.app.run(host='127.0.0.1',port=5003,debug=False)
