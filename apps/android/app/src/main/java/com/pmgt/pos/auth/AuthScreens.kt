package com.pmgt.pos.auth

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.BuildConfig
import com.pmgt.pos.R
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.text.SimpleDateFormat
import java.util.*

private val Brand=Color(0xFF0D87E1); private val Ink=Color(0xFF111827); private val Muted=Color(0xFF6B7280)
private val Border=Color(0xFFD1D5DB); private val Page=Color(0xFFF9FAFB); private val Danger=Color(0xFFDC2626)
private val Icons=FontFamily(Font(R.font.ionicons))
private data class UiAlert(val title:String,val message:String)

@Composable fun PosAuthShell(auth:AuthRepository,lock:LockState,http:ConvexHttp,configured:Boolean=BuildConfig.CONVEX_URL.isNotBlank(),showTestControls:Boolean=false,content:@Composable (SignedInUser)->Unit={SessionHome(it)}) {
 val session by auth.state.collectAsStateWithLifecycle(); val locked by lock.state.collectAsStateWithLifecycle(); val scope=rememberCoroutineScope(); var busy by remember{mutableStateOf(false)}; var lockError by remember{mutableStateOf<String?>(null)}
 fun perform(block:suspend()->Unit){if(busy)return;busy=true;scope.launch{try{block()}catch(e:CancellationException){throw e}finally{busy=false}}}
 LaunchedEffect(auth,configured){if(configured)auth.restore()}
 LaunchedEffect(session.user?.id){val user=session.user?:return@LaunchedEffect;try{lock.configure(user)}catch(e:CancellationException){throw e}}
 LaunchedEffect(session.user?.id){while(session.user!=null){delay(1000);session.user?.let{lock.tick(it)}}}
 LaunchedEffect(session.user?.id){while(session.user!=null){delay(30_000);try{auth.reloadUser()}catch(e:CancellationException){throw e}catch(_:Exception){}}}
 MaterialTheme(colorScheme=lightColorScheme(primary=Brand)){Surface(Modifier.fillMaxSize(),color=Color.White){when{
  session.user==null->LoginScreen(session.error,busy||session.loading,configured){e,p->perform{runCatching{auth.signIn(e,p)}}}
  locked.snapshot.isLocked->LockScreen(lock,session.user!!,http,busy,lockError){s,p,m->perform{lockError=lock.unlock(s,p,m)}}
  else->Box(Modifier.fillMaxSize()){content(session.user!!);if(showTestControls)Row(Modifier.align(Alignment.TopEnd).padding(8.dp)){TextButton({perform{lock.lock(session.user!!)}}){Text("Lock screen")};TextButton({perform{auth.signOut()}}){Text("Sign out")}}}
 }}}
}

@Composable private fun LoginScreen(error:String?,busy:Boolean,configured:Boolean,signIn:(String,String)->Unit){
 var email by rememberSaveable{mutableStateOf("")};var password by rememberSaveable{mutableStateOf("")};var alert by remember{mutableStateOf<UiAlert?>(null)};var shown by remember{mutableStateOf<String?>(null)}
 LaunchedEffect(error){if(error!=null&&error!=shown){shown=error;alert=UiAlert("Login Failed",error)}}
 fun submit(){when{email.isBlank()->alert=UiAlert("Error","Please enter your email");password.isEmpty()->alert=UiAlert("Error","Please enter your password");else->signIn(email.trim(),password)}}
 Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()),contentAlignment=Alignment.Center){Column(Modifier.fillMaxWidth().padding(horizontal=20.dp),horizontalAlignment=Alignment.CenterHorizontally){
  Image(painterResource(R.drawable.logo_full),"PMGT Flow Suite",Modifier.fillMaxWidth().height(224.dp).padding(top=20.dp),contentScale=ContentScale.Fit)
  Text("Enter your credentials to continue",color=Muted,textAlign=TextAlign.Center,modifier=Modifier.padding(top=24.dp,bottom=32.dp))
  AuthInput(email,{email=it},"Email",busy,KeyboardType.Email,ImeAction.Next);Spacer(Modifier.height(16.dp));AuthInput(password,{password=it},"Password",busy,KeyboardType.Password,ImeAction.Done,true,::submit);Spacer(Modifier.height(24.dp));PrimaryButton("Login",busy,Modifier.fillMaxWidth(),click=::submit)
  if(!configured)Text("Set CONVEX_URL in local.properties and rebuild to connect this app.",color=Danger,modifier=Modifier.padding(top=12.dp));Text("PMGT Flow Suite POS v1.0",color=Muted,fontSize=12.sp,modifier=Modifier.padding(top=40.dp))
 }};alert?.let{a->AlertDialog({alert=null},title={Text(a.title)},text={Text(a.message)},confirmButton={TextButton({alert=null}){Text("OK")}})}
}

@Composable private fun AuthInput(value:String,change:(String)->Unit,hint:String,busy:Boolean,type:KeyboardType,ime:ImeAction,password:Boolean=false,submit:()->Unit={})=OutlinedTextField(value,change,placeholder={Text(hint,color=Color(0xFF9CA3AF))},enabled=!busy,singleLine=true,visualTransformation=if(password)PasswordVisualTransformation() else VisualTransformation.None,keyboardOptions=KeyboardOptions(keyboardType=type,imeAction=ime),keyboardActions=KeyboardActions(onDone={submit()}),shape=RoundedCornerShape(8.dp),colors=OutlinedTextFieldDefaults.colors(focusedBorderColor=Border,unfocusedBorderColor=Border),modifier=Modifier.fillMaxWidth().heightIn(min=52.dp))
@Composable private fun PrimaryButton(label:String,loading:Boolean,modifier:Modifier=Modifier,enabled:Boolean=true,click:()->Unit)=Button(click,modifier.heightIn(min=56.dp),enabled&& !loading,shape=RoundedCornerShape(12.dp),colors=ButtonDefaults.buttonColors(containerColor=Brand)){if(loading)CircularProgressIndicator(Modifier.size(22.dp),color=Color.White,strokeWidth=2.dp)else Text(label,fontSize=18.sp,fontWeight=FontWeight.SemiBold)}

@Composable private fun LockScreen(lock:LockState,user:SignedInUser,http:ConvexHttp,busy:Boolean,error:String?,unlock:(String,String,String?)->Unit){
 val locked by lock.state.collectAsStateWithLifecycle();var pin by rememberSaveable{mutableStateOf("")};var time by remember{mutableLongStateOf(System.currentTimeMillis())};var manager by rememberSaveable{mutableStateOf(false)};var alert by remember{mutableStateOf<UiAlert?>(null)};val h=LocalConfiguration.current.screenHeightDp;val scale=if(h<820).76f else if(h<900).88f else 1f
 LaunchedEffect(Unit){while(true){delay(1000);time=System.currentTimeMillis()}};LaunchedEffect(error){if(error!=null){alert=UiAlert("Invalid PIN",error);pin=""}}
 val format=SimpleDateFormat("h:mm a",Locale.getDefault());val since=locked.snapshot.lockedAt?.let{format.format(Date(it))}.orEmpty()
 Column(Modifier.fillMaxSize().background(Page).padding(horizontal=24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center){
  Text(format.format(Date(time)),fontSize=(64*scale).sp,lineHeight=(76*scale).sp,fontWeight=FontWeight.Bold,color=Ink);Text(SimpleDateFormat("EEEE, MMMM d, yyyy",Locale.getDefault()).format(Date(time)),fontSize=maxOf(15f,18*scale).sp,color=Muted,modifier=Modifier.padding(top=maxOf(4f,6*scale).dp))
  Box(Modifier.padding(top=(38*scale).dp,bottom=(24*scale).dp).size((104*scale).dp).background(Color(0xFFDBEAFE),CircleShape),contentAlignment=Alignment.Center){Icon(62407,(42*scale).sp,Brand,"Locked")}
  Text(locked.snapshot.lockedUserName?:"User",fontSize=maxOf(22f,28*scale).sp,fontWeight=FontWeight.Bold,color=Ink);Text((locked.snapshot.lockedUserRole?:"Staff")+if(since.isNotEmpty())" • Locked since $since" else "",fontSize=maxOf(15f,18*scale).sp,color=Muted,modifier=Modifier.padding(top=maxOf(4f,6*scale).dp))
  PinPad(pin,{pin=it},busy||lock.cooldownSeconds()>0,scale,Modifier.padding(top=(34*scale).dp));if(lock.cooldownSeconds()>0)Text("Try again in ${lock.cooldownSeconds()}s",color=Danger,fontWeight=FontWeight.SemiBold,modifier=Modifier.padding(top=(16*scale).dp))
  PrimaryButton(if(busy)"Verifying..." else "Unlock",busy,Modifier.padding(top=(30*scale).dp).widthIn(min=(320*scale).dp).heightIn(min=(64*scale).dp),pin.isNotEmpty()&&lock.cooldownSeconds()==0){user.storeId?.let{unlock(it,pin,null)}}
  Text("Manager Override",color=Brand,fontSize=maxOf(15f,18*scale).sp,fontWeight=FontWeight.SemiBold,modifier=Modifier.padding(top=(22*scale).dp).clickable{manager=true}.padding(8.dp))
 };if(manager)ManagerDialog(user,http,busy,{manager=false}){id,p->user.storeId?.let{unlock(it,p,id)}};alert?.let{a->AlertDialog({alert=null},title={Text(a.title)},text={Text(a.message)},confirmButton={TextButton({alert=null}){Text("OK")}})}
}

@Composable private fun PinPad(pin:String,change:(String)->Unit,disabled:Boolean,scale:Float,modifier:Modifier=Modifier){val w=(88*scale).dp;val h=(76*scale).dp;val gap=maxOf(10f,14*scale).dp;Column(modifier,horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(gap)){
 Row(Modifier.padding(bottom=maxOf(18f,28*scale).dp),horizontalArrangement=Arrangement.spacedBy(maxOf(10f,16*scale).dp)){repeat(6){i->Box(Modifier.size(maxOf(14f,20*scale).dp).semantics{contentDescription="PIN digit ${i+1} of 6, ${if(i<pin.length)"filled" else "empty"}"}.then(if(i<pin.length)Modifier.background(Brand,CircleShape)else Modifier.border(2.dp,Border,CircleShape)))}}
 listOf(listOf("1","2","3"),listOf("4","5","6"),listOf("7","8","9"),listOf("","0","⌫")).forEach{row->Row(horizontalArrangement=Arrangement.spacedBy(gap)){row.forEach{k->when(k){""->Spacer(Modifier.size(w,h));"⌫"->Box(Modifier.size(w,h).alpha(if(disabled).5f else 1f).background(Color(0xFFFEE2E2),RoundedCornerShape((18*scale).dp)).clickable(enabled=!disabled&&pin.isNotEmpty()){change(pin.dropLast(1))},contentAlignment=Alignment.Center){Icon(61781,maxOf(24f,28*scale).sp,Color(0xFFEF4444),"Backspace")};else->Box(Modifier.size(w,h).alpha(if(disabled).5f else 1f).background(Color.White,RoundedCornerShape((18*scale).dp)).border(1.dp,Color(0xFFE5E7EB),RoundedCornerShape((18*scale).dp)).clickable(enabled=!disabled&&pin.length<6){change(pin+k)},contentAlignment=Alignment.Center){Text(k,fontSize=maxOf(24f,30*scale).sp,fontWeight=FontWeight.Medium,color=Ink)}}}}}
}}

@Composable private fun ManagerDialog(user:SignedInUser,http:ConvexHttp,busy:Boolean,close:()->Unit,submit:(String,String)->Unit){var managers by remember{mutableStateOf<List<JsonObject>?>(null)};var selected by rememberSaveable{mutableStateOf<String?>(null)};var pin by rememberSaveable{mutableStateOf("")};var failed by remember{mutableStateOf(false)}
 LaunchedEffect(user.storeId){try{managers=user.storeId?.let{http.query("helpers/usersHelpers:listManagers",buildJsonObject{put("storeId",it)}).jsonArray.map{it.jsonObject}}?:emptyList()}catch(e:CancellationException){throw e}catch(_:Exception){failed=true;managers=emptyList()}}
 AlertDialog(close,title={Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){Text("Manager Override",fontSize=18.sp,fontWeight=FontWeight.SemiBold);Icon(62026,24.sp,Muted,"Close",Modifier.clickable{close()}.padding(8.dp))}},text={Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(16.dp)){Text("A manager can unlock this screen with their PIN.",color=Muted,fontSize=14.sp);Text("Select Manager",fontWeight=FontWeight.SemiBold,fontSize=14.sp);when{managers==null->Box(Modifier.fillMaxWidth().height(48.dp),contentAlignment=Alignment.Center){CircularProgressIndicator(Modifier.size(22.dp))};failed->Text("Could not load managers. Check your connection.",color=Danger);managers!!.isEmpty()->Text("No managers with PINs available. Contact your administrator.",color=Muted,textAlign=TextAlign.Center);else->managers!!.forEach{m->val id=m.string("_id");Row(Modifier.fillMaxWidth().background(if(selected==id)Color(0xFFDBEAFE)else Page,RoundedCornerShape(10.dp)).border(1.dp,if(selected==id)Brand else Color(0xFFE5E7EB),RoundedCornerShape(10.dp)).clickable{selected=id}.padding(16.dp,12.dp),horizontalArrangement=Arrangement.SpaceBetween){Column{Text(m.optionalString("name")?:"Manager",fontWeight=FontWeight.SemiBold);Text(m.optionalString("roleName")?:"Manager",color=Muted,fontSize=13.sp)};if(selected==id)Icon(61982,20.sp,Brand,"Selected")}}};if(selected!=null){Text("Enter PIN",fontWeight=FontWeight.SemiBold,fontSize=14.sp);AuthInput(pin,{pin=it.filter(Char::isDigit).take(6)},"Enter manager PIN",busy,KeyboardType.NumberPassword,ImeAction.Done,true)}}},confirmButton={PrimaryButton(if(busy)"Verifying..." else "Unlock",busy,Modifier.fillMaxWidth(),selected!=null&&pin.isNotEmpty()){submit(requireNotNull(selected),pin)}},shape=RoundedCornerShape(16.dp),containerColor=Color.White)
}
@Composable private fun Icon(code:Int,size:TextUnit,color:Color,description:String,modifier:Modifier=Modifier)=Text(code.toChar().toString(),fontFamily=Icons,fontSize=size,color=color,modifier=modifier.semantics{contentDescription=description})
@Composable private fun SessionHome(user:SignedInUser){if(user.storeId==null)Text("No store assigned. Contact your administrator.",color=Danger)else Text("Ready for service",fontSize=30.sp)}
